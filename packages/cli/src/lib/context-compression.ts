/**
 * Smart context compression for subagent loops.
 *
 * Implements 3-tier progressive compression:
 * - Tier 1 (full):     Last N messages — kept intact
 * - Tier 2 (summarized): Middle messages — tool outputs compressed, text kept
 * - Tier 3 (metadata):   Old messages — replaced with metadata summaries
 *
 * Tool-aware: errors always preserved in full; read outputs get structure extraction.
 */

/** Messages kept at full fidelity (Tier 1). */
const DEFAULT_TIER1_COUNT = 8;
/** Messages in Tier 2 (summarized). */
const DEFAULT_TIER2_COUNT = 12;

/** Max chars for tool output in Tier 2 (errors preserved in full). */
const TIER2_TOOL_OUTPUT_MAX = 1200;
/** Max chars for tool output in Tier 3. */
const TIER3_TOOL_OUTPUT_MAX = 200;
/** Max chars for text in Tier 3. */
const TIER3_TEXT_MAX = 300;
/** Max chars for error outputs in Tier 3 (errors preserved longer). */
const TIER3_ERROR_MAX = 500;

/** Threshold above which we start Tier 2 compression on tool outputs. */
const TIER2_OUTPUT_THRESHOLD = 300;
/** Threshold above which we start Tier 3 compression. */
const TIER3_TEXT_THRESHOLD = 500;

export interface CompressionStats {
    originalCount: number;
    compressedCount: number;
    tokensSaved: number;
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
}

export interface CompressionResult {
    messages: any[];
    anchor: string | null;
    stats: CompressionStats;
}

/**
 * Apply progressive tiered compression to a message array.
 *
 * Returns a new array (does not mutate the input).
 */
export function compressContext(
    messages: any[],
    opts?: {
        tier1Count?: number;
        tier2Count?: number;
    },
): CompressionResult {
    const tier1Count = opts?.tier1Count ?? DEFAULT_TIER1_COUNT;
    const tier2Count = opts?.tier2Count ?? DEFAULT_TIER2_COUNT;
    const totalKeep = tier1Count + tier2Count;

    if (messages.length <= totalKeep) {
        return {
            messages: [...messages],
            anchor: null,
            stats: {
                originalCount: messages.length,
                compressedCount: messages.length,
                tokensSaved: 0,
                tier1Count: messages.length,
                tier2Count: 0,
                tier3Count: 0,
            },
        };
    }

    const firstUserIdx = messages.findIndex((m) => m?.role === 'user');
    const firstUser = firstUserIdx >= 0 ? messages[firstUserIdx] : null;

    // Split into tiers (excluding first user message which is always kept)
    const workingMessages =
        firstUserIdx >= 0
            ? messages.filter((_, i) => i !== firstUserIdx)
            : [...messages];

    // Tier 1 = most recent messages (keep at full fidelity)
    // Tier 2 = middle messages (compress to summaries)
    // Tier 3 = oldest messages (compress to metadata-only)
    const tier1Start = Math.max(0, workingMessages.length - tier1Count);
    const tier2Start = Math.max(0, tier1Start - tier2Count);

    const tier3Messages = workingMessages.slice(0, tier2Start);
    const tier2Messages = workingMessages.slice(tier2Start, tier1Start);
    const tier1Messages = workingMessages.slice(tier1Start);

    // Compress each tier
    const compressedTier2 = tier2Messages.map((msg) =>
        compressMessage(msg, 'tier2'),
    );
    const compressedTier3 = tier3Messages.map((msg) =>
        compressMessage(msg, 'tier3'),
    );

    // Build anchor from dropped context
    const anchor = buildAnchor(tier3Messages, tier2Messages);

    // Reassemble: anchor (as system msg) + firstUser + tier3 + tier2 + tier1
    const result: any[] = [];
    if (anchor) {
        result.push({
            id: 'compression-anchor',
            role: 'system',
            parts: [{ type: 'text', text: anchor }],
        });
    }
    if (firstUser) {
        result.push(firstUser);
    }
    result.push(...compressedTier3, ...compressedTier2, ...tier1Messages);

    const tokensSaved = estimateTokensSaved(
        tier3Messages,
        compressedTier3,
        tier2Messages,
        compressedTier2,
    );

    return {
        messages: result,
        anchor,
        stats: {
            originalCount: messages.length,
            compressedCount: result.length,
            tokensSaved,
            tier1Count: tier1Messages.length + (firstUser ? 1 : 0),
            tier2Count: compressedTier2.length,
            tier3Count: compressedTier3.length,
        },
    };
}

/**
 * Compress a single message based on its tier.
 */
function compressMessage(msg: any, tier: 'tier2' | 'tier3'): any {
    if (!msg || !msg.parts) return msg;

    const compressedParts = msg.parts.map((part: any) => {
        // Tool result parts
        if (
            (part.type === 'dynamic-tool' || part.type?.startsWith('tool-')) &&
            part.state === 'output-available' &&
            typeof part.output === 'string'
        ) {
            return compressToolOutput(part, tier);
        }
        // Text parts
        if (part.type === 'text' && typeof part.text === 'string') {
            return compressText(part, tier);
        }
        return part;
    });

    return { ...msg, parts: compressedParts };
}

/**
 * Compress a tool output part based on tier.
 */
function compressToolOutput(part: any, tier: 'tier2' | 'tier3'): any {
    const output = part.output as string;
    const toolName = getToolName(part);
    const isError = isErrorResponse(output);

    // Errors are always preserved more fully
    if (isError) {
        const maxLen =
            tier === 'tier2' ? TIER2_TOOL_OUTPUT_MAX * 2 : TIER3_ERROR_MAX;
        if (output.length <= maxLen) return part;
        return {
            ...part,
            output: truncatePreservingError(output, maxLen),
        };
    }

    const maxLen =
        tier === 'tier2' ? TIER2_TOOL_OUTPUT_MAX : TIER3_TOOL_OUTPUT_MAX;
    if (output.length <= maxLen) return part;

    // Tool-specific compression strategies
    const compressed = compressByToolType(toolName, output, maxLen);

    return { ...part, output: compressed };
}

/**
 * Tool-aware compression: extract structure for known tools instead of naive truncation.
 */
function compressByToolType(
    toolName: string,
    output: string,
    maxLen: number,
): string {
    switch (toolName) {
        case 'readFile':
            return compressFileRead(output, maxLen);
        case 'grep':
        case 'codeSearch':
            return compressSearchResults(output, maxLen);
        case 'glob':
            return compressGlobResults(output, maxLen);
        case 'gitDiff':
        case 'gitLog':
        case 'gitStatus':
            return compressGitOutput(output, maxLen);
        case 'listDirectory':
        case 'tree':
            return compressDirectoryListing(output, maxLen);
        default:
            return truncateSmart(output, maxLen);
    }
}

/**
 * Compress file read output: keep first N lines + line count summary.
 */
function compressFileRead(output: string, maxLen: number): string {
    const lines = output.split('\n');
    if (lines.length <= 20) return truncateSmart(output, maxLen);

    // Keep first 15 lines + summary
    const head = lines.slice(0, 15).join('\n');
    const summary = `\n... [${lines.length} lines total, ${output.length} chars] ...`;
    const tail = lines.slice(-5).join('\n');

    const result = `${head}\n${summary}\n${tail}`;
    return result.length <= maxLen ? result : truncateSmart(output, maxLen);
}

/**
 * Compress search results: keep file paths + match counts.
 */
function compressSearchResults(output: string, maxLen: number): string {
    // Try to extract file:line patterns
    const matches = output.match(/(?:^|\n)([\w./-]+:\d+[:\s])/gm);
    if (matches && matches.length > 10) {
        const uniqueFiles = [
            ...new Set(matches.map((m) => m.split(':')[0]?.trim())),
        ];
        const summary = uniqueFiles.slice(0, 20).join('\n');
        const result = `${summary}\n... [${matches.length} matches in ${uniqueFiles.length} files]`;
        return result.length <= maxLen ? result : truncateSmart(output, maxLen);
    }
    return truncateSmart(output, maxLen);
}

/**
 * Compress glob results: keep file list, truncate if huge.
 */
function compressGlobResults(output: string, maxLen: number): string {
    const lines = output.split('\n').filter(Boolean);
    if (lines.length <= 30) return truncateSmart(output, maxLen);

    const head = lines.slice(0, 20).join('\n');
    const result = `${head}\n... [${lines.length} files found]`;
    return result.length <= maxLen ? result : truncateSmart(output, maxLen);
}

/**
 * Compress git output: keep summary lines, drop diffs.
 */
function compressGitOutput(output: string, maxLen: number): string {
    // For diffs, keep file names and stats
    if (output.includes('diff --git')) {
        const fileHeaders = output.match(/^diff --git.+$/gm);
        if (fileHeaders && fileHeaders.length > 5) {
            const files = fileHeaders.map((h) =>
                h.replace('diff --git a/', '→ '),
            );
            const result =
                files.join('\n') +
                `\n... [${fileHeaders.length} files changed]`;
            return result.length <= maxLen
                ? result
                : truncateSmart(output, maxLen);
        }
    }
    return truncateSmart(output, maxLen);
}

/**
 * Compress directory listing: keep structure, truncate long lists.
 */
function compressDirectoryListing(output: string, maxLen: number): string {
    const lines = output.split('\n').filter(Boolean);
    if (lines.length <= 40) return truncateSmart(output, maxLen);

    const head = lines.slice(0, 25).join('\n');
    const result = `${head}\n... [${lines.length} entries]`;
    return result.length <= maxLen ? result : truncateSmart(output, maxLen);
}

/**
 * Compress a text part based on tier.
 */
function compressText(part: any, tier: 'tier2' | 'tier3'): any {
    const text = part.text;
    if (tier === 'tier2') {
        // Tier 2: keep text mostly intact, only compress very long outputs
        if (text.length <= TIER3_TEXT_THRESHOLD * 2) return part;
        return {
            ...part,
            text: truncateSmart(text, TIER2_TOOL_OUTPUT_MAX),
        };
    }
    // Tier 3: more aggressive compression
    if (text.length <= TIER3_TEXT_THRESHOLD) return part;
    return {
        ...part,
        text: truncateSmart(text, TIER3_TEXT_MAX),
    };
}

/**
 * Smart truncation: preserve beginning and end, add marker.
 */
function truncateSmart(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    const headLen = Math.floor(maxLen * 0.7);
    const tailLen = maxLen - headLen - 20; // 20 for marker
    const head = text.slice(0, headLen);
    const tail = text.slice(-tailLen);
    return `${head}\n... [truncated ${text.length - maxLen} chars] ...\n${tail}`;
}

/**
 * Truncate while preserving error message structure.
 */
function truncatePreservingError(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    // Try to keep the error message line + stack trace start
    const lines = text.split('\n');
    const errorLine = lines[0] ?? '';
    const rest = lines.slice(1).join('\n');
    const availableForRest = maxLen - errorLine.length - 50;
    if (availableForRest <= 0) {
        return truncateSmart(text, maxLen);
    }
    return `${errorLine}\n... [truncated] ...\n${truncateSmart(rest, availableForRest)}`;
}

/**
 * Build a context anchor summarizing what was dropped.
 */
function buildAnchor(
    tier3Messages: any[],
    tier2Messages: any[],
): string | null {
    if (tier3Messages.length === 0 && tier2Messages.length === 0) return null;

    const parts: string[] = [];
    const totalDropped = tier3Messages.length + tier2Messages.length;
    parts.push(
        `[Context: ${totalDropped} earlier messages compressed to save tokens.]`,
    );

    // Extract key decisions and file operations from dropped messages
    const filesModified = new Set<string>();
    const decisions: string[] = [];

    for (const msg of [...tier3Messages, ...tier2Messages]) {
        if (!msg?.parts) continue;
        for (const part of msg.parts) {
            if (
                part.type === 'dynamic-tool' ||
                part.type?.startsWith('tool-')
            ) {
                const toolName = getToolName(part);
                if (isWriteTool(toolName)) {
                    const filePath = part.input?.path ?? part.input?.file;
                    if (filePath) filesModified.add(filePath);
                }
                if (
                    part.state === 'output-available' &&
                    typeof part.output === 'string'
                ) {
                    // Extract first line of errors for decision context
                    if (isErrorResponse(part.output)) {
                        const firstLine = part.output.split('\n')[0];
                        if (firstLine)
                            decisions.push(`Error: ${firstLine.slice(0, 100)}`);
                    }
                }
            }
            // Extract text decisions
            if (part.type === 'text' && typeof part.text === 'string') {
                const text = part.text;
                if (text.includes(' decided ') || text.includes(' choosing ')) {
                    decisions.push(text.slice(0, 150));
                }
            }
        }
    }

    if (filesModified.size > 0) {
        parts.push(
            `Files modified: ${[...filesModified].slice(0, 10).join(', ')}${filesModified.size > 10 ? ` (+${filesModified.size - 10} more)` : ''}`,
        );
    }
    if (decisions.length > 0) {
        parts.push(`Key decisions: ${decisions.slice(0, 3).join(' | ')}`);
    }

    return parts.join('\n');
}

/**
 * Extract tool name from a message part.
 */
function getToolName(part: any): string {
    if (part.type === 'dynamic-tool') return part.toolName ?? 'unknown';
    if (part.type?.startsWith('tool-')) return part.type.slice(5);
    return 'unknown';
}

/**
 * Check if a tool is a write/mutation tool.
 */
function isWriteTool(toolName: string): boolean {
    return [
        'writeFile',
        'editFile',
        'searchReplace',
        'patch',
        'createFile',
        'deleteFile',
        'moveFile',
        'renameSymbol',
        'gitCommit',
        'gitBranch',
    ].includes(toolName);
}

/**
 * Check if output looks like an error response.
 */
function isErrorResponse(output: string): boolean {
    const lower = output.toLowerCase();
    return (
        lower.startsWith('error') ||
        lower.startsWith('failed') ||
        lower.includes('exception:') ||
        lower.includes('traceback') ||
        lower.includes('syntaxerror') ||
        lower.includes('enoent') ||
        lower.includes('permission denied')
    );
}

/**
 * Rough token estimate for stats (text.length / 4).
 */
function estimateTokensSaved(
    originalTier3: any[],
    compressedTier3: any[],
    originalTier2: any[],
    compressedTier2: any[],
): number {
    const originalSize = [...originalTier3, ...originalTier2].reduce(
        (sum, msg) => sum + estimateMessageSize(msg),
        0,
    );
    const compressedSize = [...compressedTier3, ...compressedTier2].reduce(
        (sum, msg) => sum + estimateMessageSize(msg),
        0,
    );
    return Math.max(0, Math.floor((originalSize - compressedSize) / 4));
}

function estimateMessageSize(msg: any): number {
    if (!msg?.parts) return 0;
    return msg.parts.reduce((sum: number, part: any) => {
        if (typeof part.text === 'string') return sum + part.text.length;
        if (typeof part.output === 'string') return sum + part.output.length;
        if (typeof part.errorText === 'string')
            return sum + part.errorText.length;
        return sum;
    }, 0);
}
