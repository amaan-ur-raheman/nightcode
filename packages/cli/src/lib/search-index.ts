import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import {
    KnowledgeGraph,
    type KnowledgeNode,
    type KnowledgeNodeType,
} from '@nightcode/shared';
import { debug } from './debug';

const KG_DIR = join(homedir(), '.nightcode', 'knowledge');
const INDEX_FILE = join(KG_DIR, 'search-index.json');

// ─── Token Processing ──────────────────────────────────────────────────────

/**
 * Split a string into searchable tokens.
 * Handles camelCase, snake_case, kebab-case, and dot-separated names.
 */
function tokenize(text: string): string[] {
    const tokens: string[] = [];

    // Split on word boundaries (camelCase), underscores, hyphens, dots, slashes
    const raw = text
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → camel Case
        .replace(/[_\-./\\]/g, ' ') // separators → spaces
        .toLowerCase();

    for (const word of raw.split(/\s+/)) {
        const trimmed = word.trim();
        if (trimmed.length >= 2) {
            tokens.push(trimmed);
        }
    }

    return tokens;
}

const MAX_EDIT_DISTANCE_LENGTH = 1000;

/**
 * Compute edit distance (Levenshtein) between two strings.
 */
function editDistance(a: string, b: string): number {
    if (
        a.length > MAX_EDIT_DISTANCE_LENGTH ||
        b.length > MAX_EDIT_DISTANCE_LENGTH
    ) {
        return Infinity;
    }
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
        new Array(b.length + 1).fill(0),
    );

    for (let i = 0; i <= a.length; i++) matrix[i]![0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0]![j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i]![j] = Math.min(
                matrix[i - 1]![j]! + 1,
                matrix[i]![j - 1]! + 1,
                matrix[i - 1]![j - 1]! + cost,
            );
        }
    }

    return matrix[a.length]![b.length]!;
}

// ─── Search Index Data ─────────────────────────────────────────────────────

interface IndexEntry {
    nodeId: string;
    tokens: string[];
    node: KnowledgeNode;
}

export interface SearchResult {
    node: KnowledgeNode;
    score: number;
    matchType: 'exact' | 'prefix' | 'substring' | 'fuzzy';
    matchedToken: string;
}

interface SearchIndexData {
    entries: IndexEntry[];
    invertedIndex: Record<string, string[]>; // token → node IDs
    totalNodes: number;
    builtAt: number;
}

// ─── Search Index Class ────────────────────────────────────────────────────

export class SearchIndex {
    private entries: Map<string, IndexEntry> = new Map();
    private invertedIndex: Map<string, Set<string>> = new Map();
    private builtAt: number = 0;

    /**
     * Build the search index from a KnowledgeGraph.
     */
    buildFromGraph(graph: KnowledgeGraph): void {
        this.entries.clear();
        this.invertedIndex.clear();

        let indexed = 0;
        for (const [nodeId, node] of graph.nodes) {
            // Skip file nodes — they're too generic for search
            if (node.type === 'file') continue;

            // Build searchable tokens from name, type, filePath, description
            const tokens = new Set<string>();

            // Tokenize the node name
            for (const t of tokenize(node.name)) {
                tokens.add(t);
            }

            // Add the full lowercase name for exact matching
            tokens.add(node.name.toLowerCase());

            // Tokenize file path components
            if (node.filePath) {
                for (const t of tokenize(node.filePath)) {
                    tokens.add(t);
                }
            }

            // Add type as a token
            tokens.add(node.type);

            // Tokenize description if available
            if (node.description) {
                for (const t of tokenize(node.description)) {
                    tokens.add(t);
                }
            }

            const entry: IndexEntry = {
                nodeId,
                tokens: Array.from(tokens),
                node,
            };

            this.entries.set(nodeId, entry);

            // Update inverted index
            for (const token of entry.tokens) {
                let posting = this.invertedIndex.get(token);
                if (!posting) {
                    posting = new Set();
                    this.invertedIndex.set(token, posting);
                }
                posting.add(nodeId);
            }

            indexed++;
        }

        this.builtAt = Date.now();
        debug.log(
            'search-index',
            `Built index: ${indexed} nodes, ${this.invertedIndex.size} unique tokens`,
        );
    }

    /**
     * Search the index for matching nodes.
     * Supports exact, prefix, substring, and fuzzy matching with ranking.
     */
    search(
        query: string,
        options: {
            nodeType?: KnowledgeNodeType;
            limit?: number;
            filePath?: string;
        } = {},
    ): SearchResult[] {
        const limit = options.limit ?? 20;
        const queryTokens = tokenize(query);
        const queryLower = query.toLowerCase();

        // Score each candidate
        const scores = new Map<
            string,
            {
                score: number;
                matchType: SearchResult['matchType'];
                matchedToken: string;
            }
        >();

        // For each query token, find matching nodes
        for (const queryToken of queryTokens) {
            // 1. Exact token match
            const exactMatch = this.invertedIndex.get(queryToken);
            if (exactMatch) {
                for (const nodeId of exactMatch) {
                    const existing = scores.get(nodeId);
                    const newScore = 100;
                    if (!existing || newScore > existing.score) {
                        scores.set(nodeId, {
                            score: newScore,
                            matchType: 'exact',
                            matchedToken: queryToken,
                        });
                    }
                }
            }

            // 2. Prefix match (tokens that start with the query)
            for (const [token, nodeIds] of this.invertedIndex) {
                if (token !== queryToken && token.startsWith(queryToken)) {
                    for (const nodeId of nodeIds) {
                        const existing = scores.get(nodeId);
                        const newScore = 80;
                        if (!existing || newScore > existing.score) {
                            scores.set(nodeId, {
                                score: newScore,
                                matchType: 'prefix',
                                matchedToken: token,
                            });
                        }
                    }
                }
            }

            // 3. Substring match
            for (const [token, nodeIds] of this.invertedIndex) {
                if (
                    token !== queryToken &&
                    !token.startsWith(queryToken) &&
                    token.includes(queryToken)
                ) {
                    for (const nodeId of nodeIds) {
                        const existing = scores.get(nodeId);
                        const newScore = 60;
                        if (!existing || newScore > existing.score) {
                            scores.set(nodeId, {
                                score: newScore,
                                matchType: 'substring',
                                matchedToken: token,
                            });
                        }
                    }
                }
            }

            // 4. Fuzzy match (edit distance <= 2, guard: same first char)
            if (queryToken.length >= 3) {
                for (const [token, nodeIds] of this.invertedIndex) {
                    if (
                        token !== queryToken &&
                        !token.startsWith(queryToken) &&
                        !token.includes(queryToken) &&
                        token[0] === queryToken[0] // same first char guard
                    ) {
                        const maxDist = queryToken.length <= 5 ? 1 : 2;
                        const dist = editDistance(queryToken, token);
                        if (dist <= maxDist && dist < token.length) {
                            for (const nodeId of nodeIds) {
                                const existing = scores.get(nodeId);
                                const newScore = 40 - dist * 10; // closer = higher score
                                if (!existing || newScore > existing.score) {
                                    scores.set(nodeId, {
                                        score: newScore,
                                        matchType: 'fuzzy',
                                        matchedToken: token,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // 5. Exact full-name match bonus
        for (const [nodeId, entry] of this.entries) {
            const nameLower = entry.node.name.toLowerCase();
            if (nameLower === queryLower) {
                const existing = scores.get(nodeId);
                const bonusScore = 150;
                if (!existing || bonusScore > existing.score) {
                    scores.set(nodeId, {
                        score: bonusScore,
                        matchType: 'exact',
                        matchedToken: entry.node.name,
                    });
                }
            } else if (nameLower.includes(queryLower)) {
                const existing = scores.get(nodeId);
                const bonusScore = 90;
                if (!existing || bonusScore > existing.score) {
                    scores.set(nodeId, {
                        score: bonusScore,
                        matchType: 'substring',
                        matchedToken: queryLower,
                    });
                }
            }
        }

        // Collect and sort results
        const results: SearchResult[] = [];

        for (const [nodeId, { score, matchType, matchedToken }] of scores) {
            const entry = this.entries.get(nodeId);
            if (!entry) continue;

            // Apply filters
            if (options.nodeType && entry.node.type !== options.nodeType)
                continue;
            if (
                options.filePath &&
                !entry.node.filePath?.includes(options.filePath)
            )
                continue;

            results.push({
                node: entry.node,
                score,
                matchType,
                matchedToken,
            });
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        return results.slice(0, limit);
    }

    /**
     * Get the number of indexed nodes.
     */
    get size(): number {
        return this.entries.size;
    }

    /**
     * Get the timestamp when the index was built.
     */
    get lastBuilt(): number {
        return this.builtAt;
    }

    // ─── Persistence ────────────────────────────────────────────────────────

    async save(): Promise<void> {
        const data: SearchIndexData = {
            entries: Array.from(this.entries.values()),
            invertedIndex: Object.fromEntries(
                Array.from(this.invertedIndex.entries()).map(([k, v]) => [
                    k,
                    Array.from(v),
                ]),
            ),
            totalNodes: this.entries.size,
            builtAt: this.builtAt,
        };

        await mkdir(KG_DIR, { recursive: true });
        await writeFile(INDEX_FILE, JSON.stringify(data), 'utf-8');
        debug.log('search-index', `Saved index: ${data.totalNodes} nodes`);
    }

    async load(): Promise<boolean> {
        try {
            const content = await readFile(INDEX_FILE, 'utf-8');
            const data: SearchIndexData = JSON.parse(content);

            this.entries.clear();
            this.invertedIndex.clear();

            for (const entry of data.entries) {
                this.entries.set(entry.nodeId, entry);
            }

            for (const [token, nodeIds] of Object.entries(data.invertedIndex)) {
                this.invertedIndex.set(token, new Set(nodeIds));
            }

            this.builtAt = data.builtAt;
            debug.log('search-index', `Loaded index: ${data.totalNodes} nodes`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if the index is stale (older than the graph).
     */
    isStale(graphLastBuilt: number): boolean {
        return this.builtAt < graphLastBuilt;
    }
}

export const searchIndex = new SearchIndex();
