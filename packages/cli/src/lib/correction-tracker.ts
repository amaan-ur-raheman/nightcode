import { memory } from './memory';

/**
 * Tracks recent tool calls and provides a feedback loop for the AI model.
 *
 * Two signal types:
 * - **Corrections** (negative): user undid an action → "avoid X"
 * - **Acceptances** (positive): user kept an action → "X works well"
 *
 * Each pattern is scored by undo speed, repetition, and time decay.
 * Stale patterns (old codebase, resolved issues) fade automatically.
 *
 * Improvements over v1:
 * - Patterns normalized by (tool, filePath) for better grouping
 * - Auto-accept timer: actions accepted after 60s without undo
 * - Session-scoped retrieval with fallback to global corrections
 * - Ranked by score with deduplication
 */

interface TrackedAction {
    tool: string;
    input: unknown;
    description: string;
    timestamp: number;
    sessionId?: string;
    /** Timer ID for auto-accept after acceptance window expires. */
    autoAcceptTimer?: ReturnType<typeof setTimeout>;
}

const MAX_TRACKED = 20;
const CORRECTION_PREFIX = 'correction:';
const POSITIVE_PREFIX = 'positive:';
const MAX_CORRECTIONS = 50;
const MAX_POSITIVE = 30;
const MAX_INJECTED_CORRECTIONS = 10;
const AUTO_ACCEPT_MS = 60_000;

/** Half-life for time decay (14 days in ms). */
const DECAY_HALFLIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** Speed thresholds for scoring undo reactions. */
const SPEED_INSTANT_MS = 3_000; // < 3s = instant (strong signal)
const SPEED_FAST_MS = 30_000; // < 30s = fast
const SPEED_SLOW_MS = 300_000; // < 5min = slow
// > 5min = very weak signal

class CorrectionTracker {
    private recentActions: TrackedAction[] = [];
    private currentSessionId?: string;

    setSession(sessionId: string): void {
        this.currentSessionId = sessionId;
    }

    /**
     * Record a tool call for potential correction/acceptance tracking.
     * Starts an auto-accept timer — if the user doesn't undo within
     * AUTO_ACCEPT_MS, the action is automatically accepted as a positive signal.
     */
    recordAction(tool: string, input: unknown, description: string): void {
        const action: TrackedAction = {
            tool,
            input,
            description,
            timestamp: Date.now(),
            sessionId: this.currentSessionId,
        };

        // Auto-accept after the acceptance window expires
        action.autoAcceptTimer = setTimeout(() => {
            void this.onAccept(action.tool, action.input, action.description);
            // Remove from tracked actions since it's been accepted
            const idx = this.recentActions.indexOf(action);
            if (idx !== -1) this.recentActions.splice(idx, 1);
        }, AUTO_ACCEPT_MS);

        this.recentActions.push(action);

        if (this.recentActions.length > MAX_TRACKED) {
            const oldest = this.recentActions.shift();
            if (oldest?.autoAcceptTimer) clearTimeout(oldest.autoAcceptTimer);
        }
    }

    /**
     * Called when undo is triggered. Extracts the last action
     * and stores a correction pattern in memory.
     */
    async onUndo(): Promise<string | null> {
        const lastAction = this.recentActions.pop();
        if (!lastAction) return null;

        // Cancel auto-accept timer since user explicitly undid
        if (lastAction.autoAcceptTimer)
            clearTimeout(lastAction.autoAcceptTimer);

        const pattern = this.generatePattern(lastAction);
        if (!pattern) return null;

        const normalizedKey = this.normalizePatternKey(lastAction);

        // Score: undo speed matters — instant undo = stronger signal
        const undoDelay = Date.now() - lastAction.timestamp;
        const speedScore = this.computeSpeedScore(undoDelay);

        // Check for repetition using normalized key (same tool + file)
        const repetition = await this.countPatternRepetition(
            normalizedKey,
            'correction',
        );

        const decayFactor = this.computeDecayFactor(lastAction.timestamp);
        const combined =
            speedScore * (1 + Math.log2(repetition + 1)) * decayFactor;

        const key = `${CORRECTION_PREFIX}${lastAction.sessionId ?? 'global'}:${Date.now()}`;
        const tags = ['correction', lastAction.tool];
        if (lastAction.sessionId) {
            tags.push(`session:${lastAction.sessionId}`);
        }

        // Store with score metadata and normalized key for deduplication
        const scoredPattern = `[score=${combined.toFixed(2)}] [key=${normalizedKey}] ${pattern}`;
        await memory.set(key, scoredPattern, tags);

        await this.enforceLimit('correction', MAX_CORRECTIONS);

        return pattern;
    }

    /**
     * Called when the user accepts an action (no undo within the acceptance window).
     * Extracts a positive pattern and stores it in memory.
     */
    async onAccept(
        tool: string,
        input: unknown,
        description: string,
    ): Promise<string | null> {
        const pattern = this.generatePositivePattern(tool, input, description);
        if (!pattern) return null;

        const normalizedKey = this.normalizePatternKey({
            tool,
            input,
            description,
        } as TrackedAction);

        // Check for repetition
        const repetition = await this.countPatternRepetition(
            normalizedKey,
            'positive',
        );

        const decayFactor = this.computeDecayFactor(Date.now());
        const combined = 0.5 * (1 + Math.log2(repetition + 1)) * decayFactor;

        const key = `${POSITIVE_PREFIX}${this.currentSessionId ?? 'global'}:${Date.now()}`;
        const tags = ['positive', tool];
        if (this.currentSessionId) {
            tags.push(`session:${this.currentSessionId}`);
        }

        const scoredPattern = `[score=${combined.toFixed(2)}] [key=${normalizedKey}] ${pattern}`;
        await memory.set(key, scoredPattern, tags);

        await this.enforceLimit('positive', MAX_POSITIVE);

        return pattern;
    }

    /**
     * Generate a normalized key for pattern grouping.
     * Groups corrections by (tool, filePath) so similar edits
     * on the same file are counted as repetitions.
     */
    private normalizePatternKey(action: TrackedAction): string {
        const getStr = (key: string, fallback = ''): string => {
            if (
                action.input === null ||
                action.input === undefined ||
                typeof action.input !== 'object'
            )
                return fallback;
            const val = (action.input as Record<string, unknown>)[key];
            return typeof val === 'string' ? val : fallback;
        };

        switch (action.tool) {
            case 'edit_file': {
                const act =
                    typeof (action.input as Record<string, unknown>)?.action ===
                    'string'
                        ? (action.input as Record<string, unknown>).action
                        : 'edit';
                return `edit_file:${act}:${getStr('path')}`;
            }
            case 'write_file':
                return `write_file:${getStr('path')}`;
            case 'run_command': {
                const act =
                    typeof (action.input as Record<string, unknown>)?.action ===
                    'string'
                        ? (action.input as Record<string, unknown>).action
                        : 'bash';
                if (act === 'bash') {
                    return `run_command:bash:${getStr('command', '').split(' ')[0] ?? 'unknown'}`;
                }
                return `run_command:${act}`;
            }
            case 'git_operation': {
                const act =
                    typeof (action.input as Record<string, unknown>)?.action ===
                    'string'
                        ? (action.input as Record<string, unknown>).action
                        : 'status';
                return `git_operation:${act}`;
            }
            case 'code_search': {
                const act =
                    typeof (action.input as Record<string, unknown>)?.action ===
                    'string'
                        ? (action.input as Record<string, unknown>).action
                        : 'search';
                if (act === 'rename_symbol') {
                    return `code_search:rename_symbol:${getStr('oldName')}→${getStr('newName')}`;
                }
                return `code_search:${act}`;
            }
            default:
                return `${action.tool}`;
        }
    }

    private computeSpeedScore(delayMs: number): number {
        if (delayMs < SPEED_INSTANT_MS) return 1.0;
        if (delayMs < SPEED_FAST_MS) return 0.7;
        if (delayMs < SPEED_SLOW_MS) return 0.3;
        return 0.1;
    }

    private computeDecayFactor(timestamp: number): number {
        const age = Date.now() - timestamp;
        return Math.pow(0.5, age / DECAY_HALFLIFE_MS);
    }

    private async countPatternRepetition(
        normalizedKey: string,
        type: 'correction' | 'positive',
    ): Promise<number> {
        const entries = await memory.list({ tag: type });
        // Count entries with the same normalized key
        return entries.filter((e) => {
            const keyMatch = e.value.match(/\[key=([^\]]+)\]/);
            return keyMatch?.[1] === normalizedKey;
        }).length;
    }

    private generatePositivePattern(
        tool: string,
        input: unknown,
        description: string,
    ): string | null {
        const getStr = (
            key: string,
            maxLen?: number,
            fallback = '',
        ): string => {
            if (
                input === null ||
                input === undefined ||
                typeof input !== 'object'
            )
                return fallback;
            const val = (input as Record<string, unknown>)[key];
            if (typeof val !== 'string') return fallback;
            return maxLen ? val.slice(0, maxLen) : val;
        };

        switch (tool) {
            case 'edit_file': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'edit';
                if (act === 'delete') {
                    return `Deleting ${getStr('path', undefined, 'unknown file')} was accepted.`;
                }
                if (act === 'move') {
                    const dest = getStr('to') || getStr('destPath') || '?';
                    return `Moving ${getStr('path', undefined, '?')} → ${dest} was accepted.`;
                }
                const filePath = getStr('path', undefined, 'unknown file');
                return `Editing ${filePath} with this pattern works well — the user accepted the change.`;
            }
            case 'write_file': {
                return `Writing to ${getStr('path', undefined, 'unknown file')} works well.`;
            }
            case 'run_command': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'bash';
                if (act === 'bash') {
                    const cmd = getStr('command', 100);
                    return `Command "${cmd}" succeeded and the user kept the result.`;
                }
                return `run_command (${act}) succeeded.`;
            }
            case 'git_operation': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'status';
                if (act === 'commit') {
                    return `Commit with message "${getStr('message')}" was accepted.`;
                }
                return `git_operation (${act}) was accepted.`;
            }
            case 'code_search': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'search';
                if (act === 'rename_symbol') {
                    return `Renaming ${getStr('oldName', undefined, '?')} → ${getStr('newName', undefined, '?')} was accepted.`;
                }
                return `code_search (${act}) succeeded.`;
            }
            default: {
                const desc = description || tool;
                return `Action "${desc}" (${tool}) succeeded and the user accepted it.`;
            }
        }
    }

    private generatePattern(action: TrackedAction): string | null {
        const { tool, input, description } = action;

        const getStr = (
            key: string,
            maxLen?: number,
            fallback = '',
        ): string => {
            if (
                input === null ||
                input === undefined ||
                typeof input !== 'object'
            )
                return fallback;
            const val = (input as Record<string, unknown>)[key];
            if (typeof val !== 'string') return fallback;
            return maxLen ? val.slice(0, maxLen) : val;
        };

        switch (tool) {
            case 'edit_file': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'edit';
                if (act === 'delete') {
                    return `Avoid deleting ${getStr('path', undefined, 'unknown file')} — the user undid this deletion.`;
                }
                if (act === 'move') {
                    const dest = getStr('to') || getStr('destPath') || '?';
                    return `Avoid moving ${getStr('path', undefined, '?')} → ${dest} — the user undid this move.`;
                }
                const filePath = getStr('path', undefined, 'unknown file');
                const oldSnippet = getStr('oldString', 80);
                if (!oldSnippet) {
                    return `Avoid editing ${filePath} — the user undid this change.`;
                }
                return `Avoid editing ${filePath} with pattern "${oldSnippet}..." — the user undid this change.`;
            }
            case 'write_file': {
                return `Avoid writing to ${getStr('path', undefined, 'unknown file')} — the user undid this change.`;
            }
            case 'run_command': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'bash';
                if (act === 'bash') {
                    const cmd = getStr('command', 100);
                    return `Avoid running command "${cmd}" — the user undid the effects of this command.`;
                }
                return `Avoid run_command (${act}) — the user undid it.`;
            }
            case 'git_operation': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'status';
                if (act === 'commit') {
                    return `Avoid committing with message "${getStr('message')}" — the user undid this commit.`;
                }
                return `Avoid git_operation (${act}) — the user undid it.`;
            }
            case 'code_search': {
                const act =
                    typeof (input as Record<string, unknown>)?.action ===
                    'string'
                        ? (input as Record<string, unknown>).action
                        : 'search';
                if (act === 'rename_symbol') {
                    const oldName = getStr('oldName', undefined, '?');
                    const newName = getStr('newName', undefined, '?');
                    return `Avoid renaming ${oldName} to ${newName} — the user undid this rename.`;
                }
                return `Avoid code_search (${act}) — the user undid it.`;
            }
            default: {
                const desc = description || tool;
                return `Avoid the action "${desc}" (${tool}) — the user undid it.`;
            }
        }
    }

    private async enforceLimit(
        type: 'correction' | 'positive',
        max: number,
    ): Promise<void> {
        const tag = type;
        const prefix =
            type === 'correction' ? CORRECTION_PREFIX : POSITIVE_PREFIX;
        const entries = await memory.list({ tag });
        if (entries.length <= max) return;

        // Sort by score (lowest first) and remove the weakest entries
        const scored = entries
            .filter((e) => e.key.startsWith(prefix))
            .map((e) => {
                const scoreMatch = e.value.match(/^\[score=([\d.]+)\]/);
                const score = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : 0;
                return { entry: e, score };
            })
            .sort((a, b) => a.score - b.score);

        const toRemove = scored.slice(0, scored.length - max);
        for (const { entry } of toRemove) {
            await memory.delete(entry.key);
        }
    }

    /**
     * Get corrections and positive patterns for the current session.
     * Returns ranked, deduplicated patterns scoped to the session.
     * Falls back to global corrections if the session has <3 corrections.
     */
    async getPatterns(): Promise<{
        corrections: string[];
        positives: string[];
    }> {
        const allEntries = await memory.list({ tag: 'correction' });
        const positiveEntries = await memory.list({ tag: 'positive' });

        // Session-scoped corrections
        let sessionCorrections = allEntries
            .filter((e) => {
                if (!this.currentSessionId) return true;
                return (
                    e.tags?.some(
                        (t) => t === `session:${this.currentSessionId}`,
                    ) ?? false
                );
            })
            .map((e) => this.extractPatternText(e.value))
            .filter(Boolean) as string[];

        // If session has fewer than 3 corrections, also include global corrections
        if (this.currentSessionId && sessionCorrections.length < 3) {
            const globalCorrections = allEntries
                .filter(
                    (e) =>
                        !e.tags?.some(
                            (t) => t === `session:${this.currentSessionId}`,
                        ),
                )
                .map((e) => this.extractPatternText(e.value))
                .filter(Boolean) as string[];
            sessionCorrections = [...sessionCorrections, ...globalCorrections];
        }

        // Deduplicate by normalized key and rank by score
        const corrections = this.deduplicateAndRank(sessionCorrections);

        const positives = positiveEntries
            .filter((e) => {
                if (!this.currentSessionId) return true;
                return (
                    e.tags?.some(
                        (t) => t === `session:${this.currentSessionId}`,
                    ) ?? true
                );
            })
            .map((e) => this.extractPatternText(e.value))
            .filter(Boolean) as string[];

        return {
            corrections: corrections.slice(0, MAX_INJECTED_CORRECTIONS),
            positives: positives.slice(0, MAX_INJECTED_CORRECTIONS),
        };
    }

    /**
     * Extract pattern text from a stored value, stripping score and key prefixes.
     */
    private extractPatternText(value: string): string | null {
        const text = value
            .replace(/^\[score=[\d.]+\]\s*/, '')
            .replace(/\[key=[^\]]+\]\s*/, '')
            .trim();
        return text || null;
    }

    /**
     * Deduplicate patterns by their normalized key (embedded in [key=...])
     * and return them ranked by score (highest first).
     */
    private deduplicateAndRank(patterns: string[]): string[] {
        const seen = new Map<string, { text: string; score: number }>();
        for (const p of patterns) {
            // Extract score from the original stored value format
            const scoreMatch = p.match(/\[score=([\d.]+)\]/);
            const score = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : 0;
            // Extract key for deduplication
            const keyMatch = p.match(/\[key=([^\]]+)\]/);
            const key = keyMatch?.[1] ?? p;
            const existing = seen.get(key);
            if (!existing || score > existing.score) {
                seen.set(key, { text: p, score });
            }
        }
        return [...seen.values()]
            .sort((a, b) => b.score - a.score)
            .map((e) => e.text);
    }

    /**
     * Get corrections for the current session (backward-compatible).
     */
    async getCorrections(): Promise<string[]> {
        const { corrections } = await this.getPatterns();
        return corrections;
    }

    /**
     * Record a suggestion as a correction entry (shows up in "Previous Corrections"
     * in the system prompt). Unlike onUndo, this doesn't require a prior tool action.
     * Used for post-hoc learning signals where the agent should have delegated.
     */
    async recordSuggestion(suggestion: string, tool?: string): Promise<void> {
        const key = `${CORRECTION_PREFIX}suggestion:${Date.now()}`;
        const tags = ['correction', 'suggestion'];
        if (tool) tags.push(tool);
        if (this.currentSessionId)
            tags.push(`session:${this.currentSessionId}`);
        const scoredPattern = `[score=0.5] ${suggestion}`;
        await memory.set(key, scoredPattern, tags);
        await this.enforceLimit('correction', MAX_CORRECTIONS);
    }

    async clearCorrections(): Promise<number> {
        const entries = await memory.list({ tag: 'correction' });
        let count = 0;
        for (const entry of entries) {
            if (entry.key.startsWith(CORRECTION_PREFIX)) {
                if (
                    !this.currentSessionId ||
                    entry.tags?.some(
                        (t) => t === `session:${this.currentSessionId}`,
                    )
                ) {
                    await memory.delete(entry.key);
                    count++;
                }
            }
        }
        return count;
    }

    /** Cancel all pending auto-accept timers (e.g., on session end). */
    cancelAllTimers(): void {
        for (const action of this.recentActions) {
            if (action.autoAcceptTimer) clearTimeout(action.autoAcceptTimer);
        }
        this.recentActions = [];
    }
}

export const correctionTracker = new CorrectionTracker();
