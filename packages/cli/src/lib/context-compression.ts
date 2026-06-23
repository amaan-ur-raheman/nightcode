/**
 * Smart context compression for subagent loops.
 *
 * Implements 3-tier progressive compression:
 * - Tier 1 (full):     Last N messages — kept intact
 * - Tier 2 (summarized): Middle messages — tool outputs compressed, text kept
 * - Tier 3 (metadata):   Old messages — replaced with metadata summaries
 *
 * Tool-aware: errors always preserved in full; read outputs get structure extraction.
 *
 * Context-mode aware: compression adapts to the current task type:
 * - "code"    → preserve code blocks and file content more aggressively
 * - "research" → preserve text and analysis more, compress tool output harder
 * - "debug"   → preserve error context and stack traces
 * - "general" → balanced compression (default)
 *
 * Progressive loading: starts with minimal context, can expand on demand.
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

/** Context modes control how compression is adapted. */
export type ContextMode = 'code' | 'research' | 'debug' | 'general';

/** Per-mode compression tuning. */
interface CompressionProfile {
    /** Tier 1 message count multiplier (1.0 = default). */
    tier1Multiplier: number;
    /** Tier 2 message count multiplier (1.0 = default). */
    tier2Multiplier: number;
    /** How aggressively to compress tool output (0.0 = keep all, 1.0 = max compression). */
    toolCompression: number;
    /** How aggressively to compress text (0.0 = keep all, 1.0 = max compression). */
    textCompression: number;
    /** Whether to preserve error context more fully. */
    preserveErrors: boolean;
    /** Whether to preserve code blocks in text. */
    preserveCode: boolean;
}

const PROFILES: Record<ContextMode, CompressionProfile> = {
    code: {
        tier1Multiplier: 1.2,
        tier2Multiplier: 1.0,
        toolCompression: 0.3, // Keep more tool output (file reads)
        textCompression: 0.2, // Keep more text (code explanations)
        preserveErrors: true,
        preserveCode: true,
    },
    research: {
        tier1Multiplier: 0.8,
        tier2Multiplier: 1.2,
        toolCompression: 0.7, // Compress tool output harder
        textCompression: 0.2, // Keep text and analysis
        preserveErrors: true,
        preserveCode: false,
    },
    debug: {
        tier1Multiplier: 1.3,
        tier2Multiplier: 0.8,
        toolCompression: 0.4,
        textCompression: 0.3,
        preserveErrors: true, // Always preserve error context
        preserveCode: true,
    },
    general: {
        tier1Multiplier: 1.0,
        tier2Multiplier: 1.0,
        toolCompression: 0.5,
        textCompression: 0.5,
        preserveErrors: true,
        preserveCode: false,
    },
};

export interface CompressionStats {
    originalCount: number;
    compressedCount: number;
    tokensSaved: number;
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
    contextMode: ContextMode;
}

export interface CompressionResult {
    messages: any[];
    anchor: string | null;
    stats: CompressionStats;
}

/**
 * Apply progressive tiered compression to a message array.
 *
 * @param contextMode - Controls how compression adapts to the task type.
 */
export function compressContext(
    messages: any[],
    opts?: {
        tier1Count?: number;
        tier2Count?: number;
        contextMode?: ContextMode;
    },
): CompressionResult {
    const mode = opts?.contextMode ?? 'general';
    const profile = PROFILES[mode];

    const tier1Count = Math.round(
        (opts?.tier1Count ?? DEFAULT_TIER1_COUNT) * profile.tier1Multiplier,
    );
    const tier2Count = Math.round(
        (opts?.tier2Count ?? DEFAULT_TIER2_COUNT) * profile.tier2Multiplier,
    );
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
                contextMode: mode,
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

    // Compress each tier with mode-aware profiles
    const compressedTier2 = tier2Messages.map((msg) =>
        compressMessage(msg, 'tier2', profile),
    );
    const compressedTier3 = tier3Messages.map((msg) =>
        compressMessage(msg, 'tier3', profile),
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
            contextMode: mode,
        },
    };
}

/**
 * Detect the most likely context mode from a user message.
 */
export function detectContextMode(userMessage: string): ContextMode {
    const lower = userMessage.toLowerCase();

    // Debug signals
    if (
        lower.includes('error') ||
        lower.includes('bug') ||
        lower.includes('fix') ||
        lower.includes('crash') ||
        lower.includes('traceback') ||
        lower.includes('exception')
    ) {
        return 'debug';
    }

    // Code signals
    if (
        lower.includes('implement') ||
        lower.includes('write') ||
        lower.includes('create') ||
        lower.includes('add') ||
        lower.includes('refactor') ||
        lower.includes('code') ||
        lower.includes('function') ||
        lower.includes('class') ||
        lower.includes('file')
    ) {
        return 'code';
    }

    // Research signals
    if (
        lower.includes('explain') ||
        lower.includes('analyze') ||
        lower.includes('investigate') ||
        lower.includes('research') ||
        lower.includes('how') ||
        lower.includes('why') ||
        lower.includes('what')
    ) {
        return 'research';
    }

    return 'general';
}

/**
 * Compress a single message based on its tier and profile.
 */
function compressMessage(
    msg: any,
    tier: 'tier2' | 'tier3',
    profile: CompressionProfile,
): any {
    if (!msg || !msg.parts) return msg;

    const compressedParts = msg.parts.map((part: any) => {
        // Tool result parts
        if (
            (part.type === 'dynamic-tool' || part.type?.startsWith('tool-')) &&
            part.state === 'output-available' &&
            typeof part.output === 'string'
        ) {
            return compressToolOutput(part, tier, profile);
        }
        // Text parts
        if (part.type === 'text' && typeof part.text === 'string') {
            return compressText(part, tier, profile);
        }
        return part;
    });

    return { ...msg, parts: compressedParts };
}

/**
 * Compress a tool output part based on tier and profile.
 */
function compressToolOutput(
    part: any,
    tier: 'tier2' | 'tier3',
    profile: CompressionProfile,
): any {
    const output = part.output as string;
    const toolName = getToolName(part);
    const isError = isErrorResponse(output);

    // Errors are always preserved more fully
    if (isError && profile.preserveErrors) {
        const maxLen =
            tier === 'tier2' ? TIER2_TOOL_OUTPUT_MAX * 2 : TIER3_ERROR_MAX;
        if (output.length <= maxLen) return part;
        return {
            ...part,
            output: truncatePreservingError(output, maxLen),
        };
    }

    // Apply mode-aware compression factor
    const baseMaxLen =
        tier === 'tier2' ? TIER2_TOOL_OUTPUT_MAX : TIER3_TOOL_OUTPUT_MAX;
    const compressionFactor = profile.toolCompression;
    // Lower compression = higher maxLen (keep more content)
    const maxLen = Math.round(baseMaxLen * (1 + (1 - compressionFactor)));

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
 * Compress a text part based on tier and profile.
 */
function compressText(
    part: any,
    tier: 'tier2' | 'tier3',
    profile: CompressionProfile,
): any {
    const text = part.text;

    // In code mode, preserve code blocks
    if (profile.preserveCode && tier === 'tier2') {
        const codeBlockRegex = /```[\s\S]*?```/g;
        const codeBlocks: string[] = [];
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            codeBlocks.push(match[0]);
        }
        if (codeBlocks.length > 0) {
            // Keep code blocks, compress surrounding text
            const textWithoutCode = text.replace(
                codeBlockRegex,
                '[code block]',
            );
            if (textWithoutCode.length <= TIER3_TEXT_THRESHOLD * 2) return part;
            return {
                ...part,
                text: truncateSmart(textWithoutCode, TIER2_TOOL_OUTPUT_MAX),
            };
        }
    }

    if (tier === 'tier2') {
        // Tier 2: keep text mostly intact, only compress very long outputs
        const compressionFactor = profile.textCompression;
        const maxLen = Math.round(
            TIER3_TEXT_THRESHOLD * 2 * (1 + (1 - compressionFactor)),
        );
        if (text.length <= maxLen) return part;
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
 * Enhanced to preserve reasoning chains (the WHY behind decisions),
 * not just file lists and errors.
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

    // Extract key decisions, reasoning chains, and file operations
    const filesModified = new Set<string>();
    const decisions: string[] = [];
    const reasoningChains: string[] = [];
    const toolsUsed = new Set<string>();
    const strategies: string[] = [];

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
                if (toolName) {
                    toolsUsed.add(toolName);
                }
                if (
                    part.state === 'output-available' &&
                    typeof part.output === 'string'
                ) {
                    // Extract first line of errors for decision context
                    if (isErrorResponse(part.output)) {
                        const firstLine = part.output.split('\n')[0];
                        if (firstLine && firstLine.length > 3)
                            decisions.push(`Error: ${firstLine.slice(0, 100)}`);
                    }
                }
            }
            // Extract reasoning chains from text parts
            if (part.type === 'text' && typeof part.text === 'string') {
                const text = part.text.trim();

                // Capture decision statements with reasoning
                const decisionPatterns = [
                    /(?:I chose|I decided|I opted|I picked|I selected|Using|Preferring|Going with)[^.]*\./gi,
                    /(?:Therefore|Because|Since|Given that|As a result)[^.]*\./gi,
                    /(?:The reason|My rationale|The approach|The strategy)[^.]*\./gi,
                    /(?:After considering|After reviewing|Based on)[^.]*\./gi,
                    /(?:This means|This implies|Consequently)[^.]*\./gi,
                    /(?:Let me|I'll|I should|I need to|I'm going to)[^.]*\./gi,
                ];

                for (const pattern of decisionPatterns) {
                    const matches = text.match(pattern);
                    if (matches) {
                        for (const m of matches) {
                            const trimmed = m.trim();
                            if (trimmed.length > 10 && trimmed.length < 300) {
                                decisions.push(trimmed);
                            }
                        }
                    }
                }

                // Capture multi-sentence reasoning chains (2-4 connected sentences)
                // These represent thought processes behind decisions
                const reasoningRegex =
                    /(?:First|Next|Then|Finally|Step \d+)[^.]*\.(?:\s*[A-Z][^.]*\.){0,3}/g;
                const reasoningMatches = text.match(reasoningRegex);
                if (reasoningMatches) {
                    for (const rm of reasoningMatches) {
                        const trimmed = rm.trim();
                        if (trimmed.length > 20 && trimmed.length < 400) {
                            reasoningChains.push(trimmed);
                        }
                    }
                }

                // Capture strategy/goal statements
                const strategyPatterns = [
                    /(?:The goal|The objective|The plan|The approach is|The strategy is)[^.]*\./gi,
                    /(?:To fix|To implement|To address|To resolve|To add)[^.]*\./gi,
                ];
                for (const pattern of strategyPatterns) {
                    const matches = text.match(pattern);
                    if (matches) {
                        for (const m of matches) {
                            const trimmed = m.trim();
                            if (trimmed.length > 15 && trimmed.length < 300) {
                                strategies.push(trimmed);
                            }
                        }
                    }
                }
            }
        }
    }

    if (filesModified.size > 0) {
        parts.push(
            `Files modified: ${[...filesModified].slice(0, 10).join(', ')}${filesModified.size > 10 ? ` (+${filesModified.size - 10} more)` : ''}`,
        );
    }

    if (toolsUsed.size > 0) {
        parts.push(`Tools used: ${[...toolsUsed].slice(0, 8).join(', ')}`);
    }

    // Reasoning chains: the most valuable for maintaining context continuity
    const uniqueReasoning = [...new Set(reasoningChains)];
    if (uniqueReasoning.length > 0) {
        parts.push(`Reasoning chain: ${uniqueReasoning.slice(0, 2).join(' ')}`);
    }

    // Key decisions and strategies — the WHY
    const allDecisions = [...strategies.slice(0, 2), ...decisions.slice(0, 3)];
    if (allDecisions.length > 0) {
        parts.push(`Key decisions: ${allDecisions.slice(0, 3).join(' | ')}`);
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

// ── Progressive Context Loader ──

/**
 * Progressive context loader: starts with minimal context and expands on demand.
 * Useful for long-running sessions where early context becomes less relevant.
 */
export class ProgressiveContextLoader {
    private loaded = 0;
    private messages: any[] = [];
    private contextMode: ContextMode;

    constructor(messages: any[], contextMode: ContextMode = 'general') {
        this.messages = messages;
        this.contextMode = contextMode;
    }

    /**
     * Get the next batch of context. Initially returns only Tier 1 (recent).
     * Call repeatedly to expand with older context.
     */
    getNextBatch(batchSize: number = 10): {
        messages: any[];
        hasMore: boolean;
    } {
        const remaining = this.messages.length - this.loaded;
        if (remaining <= 0) {
            return { messages: [], hasMore: false };
        }

        const start = Math.max(
            0,
            this.messages.length - this.loaded - batchSize,
        );
        const batch = this.messages.slice(
            start,
            this.messages.length - this.loaded,
        );
        this.loaded += batch.length;

        return {
            messages: batch,
            hasMore: start > 0,
        };
    }

    /**
     * Get a fully compressed version of all context.
     * Used when token budget is tight.
     */
    getCompressed(): CompressionResult {
        return compressContext(this.messages, {
            contextMode: this.contextMode,
        });
    }

    /**
     * Get just the most recent N messages without compression.
     */
    getRecent(count: number): any[] {
        return this.messages.slice(-count);
    }

    /**
     * Reset to start fresh.
     */
    reset(): void {
        this.loaded = 0;
    }

    /**
     * Get current progress.
     */
    getProgress(): { loaded: number; total: number } {
        return { loaded: this.loaded, total: this.messages.length };
    }
}
