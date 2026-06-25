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

/** Threshold above which we start Tier 3 compression. */
const TIER3_TEXT_THRESHOLD = 500;

// ── Importance Scoring ──

/** Importance weights for message scoring. */
const IMPORTANCE = {
    /** Messages with errors are critical context. */
    HAS_ERROR: 3,
    /** Messages with file modifications (write/edit). */
    HAS_FILE_EDIT: 2,
    /** Messages with reasoning/decisions (the WHY). */
    HAS_REASONING: 2,
    /** Messages with tool outputs (vs pure text). */
    HAS_TOOL_OUTPUT: 1,
    /** Recency bonus: more recent = higher score. */
    RECENCY_BASE: 0.1,
    /** Messages with code blocks. */
    HAS_CODE: 1,
} as const;

/**
 * Score a message's importance for retention during compression.
 * Higher scores = keep this message.
 */
function scoreMessageImportance(msg: any, idx: number, total: number): number {
    if (!msg?.parts) return 0;
    let score = 0;

    // Recency: linear decay from most recent
    const recencyFactor = idx / Math.max(1, total - 1);
    score += IMPORTANCE.RECENCY_BASE * recencyFactor;

    for (const part of msg.parts) {
        // Error outputs: critical context
        if (
            (part.type === 'dynamic-tool' || part.type?.startsWith('tool-')) &&
            part.state === 'output-available' &&
            typeof part.output === 'string'
        ) {
            if (isErrorResponse(part.output)) {
                score += IMPORTANCE.HAS_ERROR;
            }
        }
        // File modifications
        if (part.type === 'dynamic-tool' || part.type?.startsWith('tool-')) {
            const toolName = getToolName(part);
            if (isWriteTool(toolName, part.input?.action)) {
                score += IMPORTANCE.HAS_FILE_EDIT;
            }
        }
        // Text with reasoning
        if (part.type === 'text' && typeof part.text === 'string') {
            const reasoningPatterns =
                /(?:I chose|I decided|Therefore|Because|The strategy|The approach|To fix|To implement)/i;
            if (reasoningPatterns.test(part.text)) {
                score += IMPORTANCE.HAS_REASONING;
            }
            // Code blocks
            if (part.text.includes('```')) {
                score += IMPORTANCE.HAS_CODE;
            }
        }
    }

    return score;
}

/**
 * Select the best N messages to keep in Tier 1 using importance scoring.
 * Falls back to recency-based selection if scores are all equal.
 */
function selectTopByImportance(
    messages: any[],
    count: number,
): { selected: Set<number>; scores: number[] } {
    const scores = messages.map((msg, idx) =>
        scoreMessageImportance(msg, idx, messages.length),
    );

    // If all scores are equal (or within 0.1), fall back to recency
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    if (maxScore - minScore < 0.1) {
        // Pure recency selection
        const selected = new Set<number>();
        for (let i = messages.length - count; i < messages.length; i++) {
            if (i >= 0) selected.add(i);
        }
        return { selected, scores };
    }

    // Rank by score, break ties by recency (prefer more recent)
    const ranked = messages
        .map((_, idx) => ({ idx, score: scores[idx]! }))
        .sort((a, b) => {
            if (Math.abs(a.score - b.score) > 0.1) return b.score - a.score;
            return b.idx - a.idx; // Tie-break: prefer more recent (higher index)
        });

    const selected = new Set<number>();
    for (let i = 0; i < count && i < ranked.length; i++) {
        selected.add(ranked[i]!.idx);
    }

    return { selected, scores };
}

/**
 * Enhanced token estimation using simple heuristics.
 * Returns estimated token count for a message.
 */
export function estimateTokens(msg: any): number {
    if (!msg?.parts) return 0;
    let tokens = 0;
    for (const part of msg.parts) {
        if (typeof part.text === 'string') {
            // Rough: ~1 token per 4 chars for English, ~1 per 3 for code
            const hasCode = part.text.includes('```');
            tokens += Math.ceil(part.text.length / (hasCode ? 3 : 4));
        }
        if (typeof part.output === 'string') {
            tokens += Math.ceil(part.output.length / 4);
        }
        if (typeof part.errorText === 'string') {
            tokens += Math.ceil(part.errorText.length / 3);
        }
    }
    return tokens;
}

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
 * Uses importance scoring to select which messages to keep in Tier 1
 * instead of just keeping the most recent N messages.
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

    // Use importance scoring to select Tier 1 messages
    const { selected: tier1Indices } = selectTopByImportance(
        workingMessages,
        tier1Count,
    );

    // Tier 2 = most recent leftovers (middle messages), Tier 3 = oldest leftovers
    const remainingIndices = workingMessages
        .map((_, idx) => idx)
        .filter((idx) => !tier1Indices.has(idx))
        .sort((a, b) => b - a); // descending: most recent first
    const tier2Indices = new Set(remainingIndices.slice(0, tier2Count));

    // Build tier arrays
    const tier1Messages = [...tier1Indices]
        .sort((a, b) => a - b)
        .map((idx) => workingMessages[idx]);
    const tier2Messages = [...tier2Indices]
        .sort((a, b) => a - b)
        .map((idx) => workingMessages[idx]);
    const tier3Messages = remainingIndices
        .slice(tier2Count)
        .sort((a, b) => a - b) // restore chronological order for Tier 3
        .map((idx) => workingMessages[idx]);

    // Compress each tier with mode-aware profiles
    const compressedTier2 = tier2Messages.map((msg) =>
        compressMessage(msg, 'tier2', profile),
    );
    const compressedTier3 = tier3Messages.map((msg) =>
        compressMessage(msg, 'tier3', profile),
    );

    // Build anchor from dropped context
    const anchor = buildAnchor(workingMessages);

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
        case 'read_file':
            return compressFileRead(output, maxLen);
        case 'code_search':
            return compressSearchResults(output, maxLen);
        case 'git_operation':
            return compressGitOutput(output, maxLen);
        case 'list_dir':
            return compressDirectoryListing(output, maxLen);
        default:
            return truncateSmart(output, maxLen);
    }
}

/**
 * Fold function and class bodies to collapse implementations
 * while preserving declaration signatures.
 */
function foldCodeBodies(code: string): string {
    const lines = code.split('\n');
    const result: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line === undefined) {
            i++;
            continue;
        }

        // Matches function/method/class definitions ending with {
        const isSignature =
            /^\s*(?:export\s+|default\s+|async\s+|public\s+|private\s+|protected\s+|static\s+)*(?:function|class|const|let|var|interface|type|\w+\s*\([^)]*\))\b.*\{\s*$/.test(
                line,
            ) || /^\s*\w+\s*\([^)]*\)\s*(?::\s*[\w<>|]+)?\s*\{\s*$/.test(line);
        if (isSignature) {
            result.push(line);
            let braceCount = 1;
            const startIndex = i + 1;
            let j = i + 1;
            while (j < lines.length && braceCount > 0) {
                const curLine = lines[j];
                if (curLine === undefined) {
                    j++;
                    continue;
                }
                for (const char of curLine) {
                    if (char === '{') braceCount++;
                    else if (char === '}') braceCount--;
                }
                j++;
            }
            const bodyLinesCount = j - startIndex - 1;
            if (bodyLinesCount > 4) {
                const matchIndent = line.match(/^\s*/);
                const indent = matchIndent ? matchIndent[0] : '';
                result.push(
                    `${indent}    // ... [code body folded: ${bodyLinesCount} lines] ...`,
                );
                const lastLine = lines[j - 1];
                if (lastLine !== undefined) result.push(lastLine);
            } else {
                for (let k = startIndex; k < j; k++) {
                    const l = lines[k];
                    if (l !== undefined) result.push(l);
                }
            }
            i = j;
        } else {
            result.push(line);
            i++;
        }
    }
    return result.join('\n');
}

/**
 * Compress file read output: keep first N lines + line count summary.
 * Prioritizes code body folding for structured folding before resorting to truncation.
 */
function compressFileRead(output: string, maxLen: number): string {
    const folded = foldCodeBodies(output);
    if (folded.length <= maxLen) return folded;

    const lines = folded.split('\n');
    if (lines.length <= 20) return truncateSmart(folded, maxLen);

    // Keep first 15 lines + summary
    const head = lines.slice(0, 15).join('\n');
    const summary = `\n... [${lines.length} lines total, ${folded.length} chars] ...`;
    const tail = lines.slice(-5).join('\n');

    const result = `${head}\n${summary}\n${tail}`;
    return result.length <= maxLen ? result : truncateSmart(folded, maxLen);
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
 * When preserveCode is true, code blocks are preserved in full and only
 * surrounding prose is compressed.
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
            // Keep code blocks intact, compress surrounding text
            const textWithoutCode = text.replace(codeBlockRegex, '');
            const proseLen = textWithoutCode.length;
            // If prose is short enough, keep everything
            if (proseLen <= TIER3_TEXT_THRESHOLD * 2) return part;
            // Compress the prose, keep code blocks verbatim
            const compressedProse = truncateSmart(
                textWithoutCode,
                Math.round(
                    TIER3_TEXT_THRESHOLD * (1 + (1 - profile.textCompression)),
                ),
            );
            // Reassemble: compressed prose + code blocks
            const result = [compressedProse, ...codeBlocks].join('\n\n');
            return { ...part, text: result };
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
function buildAnchor(allMessages: any[]): string | null {
    if (allMessages.length === 0) return null;

    const parts: string[] = [];
    parts.push(
        `[Context: Earlier conversation history was compressed to save tokens.]`,
    );

    // Extract key decisions, reasoning chains, and file operations
    const filesModified = new Set<string>();
    const decisions: string[] = [];
    const reasoningChains: string[] = [];
    const toolsUsed = new Set<string>();
    const strategies: string[] = [];

    for (const msg of allMessages) {
        if (!msg?.parts) continue;
        for (const part of msg.parts) {
            if (
                part.type === 'dynamic-tool' ||
                part.type?.startsWith('tool-')
            ) {
                const toolName = getToolName(part);
                if (isWriteTool(toolName, part.input?.action)) {
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
function isWriteTool(toolName: string, action?: string): boolean {
    if (toolName === 'code_search') return action === 'rename_symbol';
    if (toolName === 'git_operation') {
        const readOnlyActions = new Set([
            'status',
            'diff',
            'log',
            'blame',
            'status_extended',
            'check_external_changes',
        ]);
        return !readOnlyActions.has(action ?? '');
    }
    if (toolName === 'run_command') {
        const readOnlyActions = new Set([
            'token_count',
            'validate_code',
            'profile_code',
        ]);
        return !readOnlyActions.has(action ?? '');
    }
    return ['write_file', 'edit_file'].includes(toolName);
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
 * Rough token estimate for stats using improved heuristics.
 */
function estimateTokensSaved(
    originalTier3: any[],
    compressedTier3: any[],
    originalTier2: any[],
    compressedTier2: any[],
): number {
    const originalSize = [...originalTier3, ...originalTier2].reduce(
        (sum, msg) => sum + estimateTokens(msg),
        0,
    );
    const compressedSize = [...compressedTier3, ...compressedTier2].reduce(
        (sum, msg) => sum + estimateTokens(msg),
        0,
    );
    return Math.max(0, originalSize - compressedSize);
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
