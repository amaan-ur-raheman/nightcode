import { relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { IGNORE, MAX_MATCHES, MAX_DIFF, resolveInsideCwd } from './utils';
import { renameSymbolTool } from './rename-symbol';
import { searchIndex } from '@/lib/search-index';
import { knowledgeGraphManager } from '@/lib/knowledge-graph';
import { readCachedFile } from './utils';

const PATTERNS: [string, RegExp][] = [
    ['class', /^(?:export\s+)?(?:abstract\s+)?class\s+(?<name>\w+)/],
    [
        'function',
        /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(?<name>\w+)\s*[(<]/,
    ],
    [
        'arrow',
        /^(?:export\s+)?(?:const|let|var)\s+(?<name>\w+)\s*=\s*(?:async\s+)?\(/,
    ],
    ['const', /^(?:export\s+)?(?:const|let|var)\s+(?<name>\w+)\s*=/],
    ['type', /^(?:export\s+)?type\s+(?<name>\w+)\s*=/],
    ['interface', /^(?:export\s+)?interface\s+(?<name>\w+)/],
    ['enum', /^(?:export\s+)?(?:const\s+)?enum\s+(?<name>\w+)/],
    ['def', /^(?:async\s+)?def\s+(?<name>\w+)\s*\(/],
    ['func', /^func\s+(?<name>\w+)\s*\(/],
    ['fn', /^(?:pub\s+)?(?:async\s+)?fn\s+(?<name>\w+)\s*[(<]/],
];

export async function codeSearchTool(
    input: unknown,
    _parentMode?: string,
    _parentModel?: string,
    signal?: AbortSignal,
) {
    const parsed = toolInputSchemas.code_search.parse(input);
    const { action } = parsed;

    if (action === 'search') {
        const { symbol, path, include } = parsed;
        if (!symbol) throw new Error('symbol is required for search action');
        const { cwd, resolved } = resolveInsideCwd(path);
        const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            `(function|async function)\\s+${s}\\s*\\(`,
            `(const|let|var)\\s+${s}\\s*=\\s*(async\\s+)?\\(`,
            `(const|let|var)\\s+${s}\\s*=\\s*(async\\s+)?function`,
            `class\\s+${s}(\\s|\\{|extends)`,
            `(export\\s+)?(default\\s+)?(function|class|const|let|var)\\s+${s}[\\s\\(=<{]`,
            `${s}\\s*:\\s*(function|\\()`,
            `def\\s+${s}\\s*\\(`,
            `func\\s+${s}\\s*\\(`,
            `fn\\s+${s}\\s*\\(`,
        ];
        const args = [
            '-rn',
            '--color=never',
            '--binary-files=without-match',
            '-E',
        ];
        for (const dir of IGNORE) {
            args.push(`--exclude-dir=${dir}`);
        }
        args.push(patterns.join('|'));
        if (include) args.push(`--include=${include}`);
        args.push(resolved);

        const proc = Bun.spawn(['grep', ...args], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
        });

        const onAbort = () => proc.kill('SIGKILL');
        signal?.addEventListener('abort', onAbort);

        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        signal?.removeEventListener('abort', onAbort);

        if (exitCode !== 0 && exitCode !== 1)
            return { error: `Search failed: ${stderr.trim()}` };
        if (!stdout.trim())
            return { matches: [], message: 'No definitions found' };

        const lines = stdout.trim().split('\n');
        const matches: { file: string; line: number; content: string }[] = [];
        let truncated = false;

        for (const line of lines) {
            if (matches.length >= MAX_MATCHES) {
                truncated = true;
                break;
            }
            const match = line.match(/^(.+?):(\d+):(.*)$/);
            if (match)
                matches.push({
                    file: relative(cwd, match[1]!),
                    line: Number(match[2]),
                    content: match[3]!.trim(),
                });
        }

        return { matches, ...(truncated ? { truncated: true } : {}) };
    }

    if (action === 'semantic') {
        const { query, nodeType, limit, path } = parsed;
        if (!query) throw new Error('query is required for semantic action');
        const graph = knowledgeGraphManager.getGraph();

        if (searchIndex.size === 0 || searchIndex.isStale(graph.lastBuilt)) {
            if (graph.nodes.size === 0) {
                try {
                    await knowledgeGraphManager.load();
                    const loadedGraph = knowledgeGraphManager.getGraph();
                    searchIndex.buildFromGraph(loadedGraph);
                    await searchIndex.save();
                } catch {
                    return {
                        error: 'No knowledge graph available. Run knowledge_graph action="build" first to scan the project.',
                    };
                }
            } else {
                searchIndex.buildFromGraph(graph);
                await searchIndex.save();
            }
        }

        const results = searchIndex.search(query, {
            nodeType,
            limit,
            filePath: path !== '.' ? path : undefined,
        });

        if (results.length === 0) {
            return {
                query,
                results: [],
                message: `No results found for "${query}". Try a different query or check spelling.`,
            };
        }

        return {
            query,
            totalResults: results.length,
            results: results.map((r) => ({
                name: r.node.name,
                type: r.node.type,
                filePath: r.node.filePath ?? 'unknown',
                line: r.node.startLine,
                exported: r.node.exported,
                description: r.node.description,
                score: r.score,
                matchType: r.matchType,
                matchedToken: r.matchedToken,
            })),
            hint:
                results.length === (limit ?? 20)
                    ? 'Results were limited. Increase limit or add filters for more specific results.'
                    : undefined,
        };
    }

    if (action === 'outline') {
        const { path } = parsed;
        const { cwd, resolved } = resolveInsideCwd(path);
        const lines = (await readCachedFile(resolved)).split('\n');
        const symbols: { name: string; kind: string; line: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!.trimStart();
            for (const [kind, pattern] of PATTERNS) {
                const match = pattern.exec(line);
                if (match?.groups?.name) {
                    symbols.push({
                        name: match.groups.name,
                        kind,
                        line: i + 1,
                    });
                    break;
                }
            }
        }

        return { path: relative(cwd, resolved), symbols };
    }

    if (action === 'diff') {
        const { path: pathA, pathB } = parsed;
        if (!pathB) throw new Error('pathB is required for diff action');
        const { resolved: resolvedA } = resolveInsideCwd(pathA);
        const { cwd, resolved: resolvedB } = resolveInsideCwd(pathB);

        const proc = Bun.spawn(['diff', '-u', resolvedA, resolvedB], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;

        if (exitCode === 2) return { error: stderr.trim() };
        if (exitCode === 0) return { diff: '', identical: true };

        const diff = stdout;
        return {
            diff:
                diff.length > MAX_DIFF
                    ? diff.slice(0, MAX_DIFF) +
                      `\n...(truncated, ${diff.length} total chars)`
                    : diff,
            ...(diff.length > MAX_DIFF ? { truncated: true } : {}),
        };
    }

    if (action === 'rename_symbol') {
        const { symbol, newName, glob, dryRun, fileTypes } = parsed;
        if (!symbol || !newName || !glob) {
            throw new Error(
                'symbol, newName, and glob are required for rename_symbol action',
            );
        }
        return await renameSymbolTool({
            oldName: symbol,
            newName,
            glob,
            dryRun,
            fileTypes,
        });
    }

    throw new Error(`Unknown action: ${action}`);
}
