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
 */

interface TrackedAction {
    tool: string;
    input: unknown;
    description: string;
    timestamp: number;
    sessionId?: string;
}

interface PatternScore {
    /** Speed of signal: instant undo = 1.0, after 30s = 0.5, after 5min = 0.1 */
    speedScore: number;
    /** Repetition: same pattern seen N times */
    repetition: number;
    /** Time decay: halflife of 14 days */
    decayFactor: number;
    /** Combined score for ranking */
    combined: number;
}

const MAX_TRACKED = 20;
const CORRECTION_PREFIX = 'correction:';
const POSITIVE_PREFIX = 'positive:';
const MAX_CORRECTIONS = 50;
const MAX_POSITIVE = 30;

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
     */
    recordAction(tool: string, input: unknown, description: string): void {
        this.recentActions.push({
            tool,
            input,
            description,
            timestamp: Date.now(),
            sessionId: this.currentSessionId,
        });

        if (this.recentActions.length > MAX_TRACKED) {
            this.recentActions.shift();
        }
    }

    /**
     * Called when undo is triggered. Extracts the last action
     * and stores a correction pattern in memory.
     */
    async onUndo(): Promise<string | null> {
        const lastAction = this.recentActions.pop();
        if (!lastAction) return null;

        const pattern = this.generatePattern(lastAction);
        if (!pattern) return null;

        // Score: undo speed matters — instant undo = stronger signal
        const undoDelay = Date.now() - lastAction.timestamp;
        const speedScore = this.computeSpeedScore(undoDelay);

        // Check for repetition (same pattern seen before)
        const repetition = await this.countPatternRepetition(
            pattern,
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

        // Store with score metadata in the value
        const scoredPattern = `[score=${combined.toFixed(2)}] ${pattern}`;
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

        // Check for repetition
        const repetition = await this.countPatternRepetition(
            pattern,
            'positive',
        );

        const decayFactor = this.computeDecayFactor(Date.now());
        const combined = 0.5 * (1 + Math.log2(repetition + 1)) * decayFactor;

        const key = `${POSITIVE_PREFIX}${this.currentSessionId ?? 'global'}:${Date.now()}`;
        const tags = ['positive', tool];
        if (this.currentSessionId) {
            tags.push(`session:${this.currentSessionId}`);
        }

        const scoredPattern = `[score=${combined.toFixed(2)}] ${pattern}`;
        await memory.set(key, scoredPattern, tags);

        await this.enforceLimit('positive', MAX_POSITIVE);

        return pattern;
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
        pattern: string,
        type: 'correction' | 'positive',
    ): Promise<number> {
        const prefix =
            type === 'correction' ? CORRECTION_PREFIX : POSITIVE_PREFIX;
        const entries = await memory.list({ tag: type });
        // Count entries whose value contains the core pattern (ignoring score prefix)
        const corePattern = pattern.replace(/^\[score=[\d.]+\]\s*/, '');
        return entries.filter((e) => {
            if (!e.key.startsWith(prefix)) return false;
            const core = e.value.replace(/^\[score=[\d.]+\]\s*/, '');
            return core === corePattern;
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
            case 'editFile':
            case 'searchReplace': {
                const filePath = getStr('path', undefined, 'unknown file');
                return `Editing ${filePath} with this pattern works well — the user accepted the change.`;
            }
            case 'writeFile': {
                return `Writing to ${getStr('path', undefined, 'unknown file')} works well.`;
            }
            case 'bash': {
                const cmd = getStr('command', 100);
                return `Command "${cmd}" succeeded and the user kept the result.`;
            }
            case 'gitCommit': {
                return `Commit with message "${getStr('message')}" was accepted.`;
            }
            case 'deleteFile': {
                return `Deleting ${getStr('path', undefined, 'unknown file')} was accepted.`;
            }
            case 'moveFile': {
                return `Moving ${getStr('from', undefined, '?')} → ${getStr('to', undefined, '?')} was accepted.`;
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
            case 'editFile':
            case 'searchReplace': {
                const filePath = getStr('path', undefined, 'unknown file');
                const oldSnippet = getStr('oldString', 80);
                return `Avoid editing ${filePath} with pattern "${oldSnippet}..." — the user undid this change.`;
            }
            case 'writeFile': {
                return `Avoid writing to ${getStr('path', undefined, 'unknown file')} — the user undid this change.`;
            }
            case 'bash': {
                const cmd = getStr('command', 100);
                return `Avoid running command "${cmd}" — the user undid the effects of this command.`;
            }
            case 'gitCommit': {
                return `Avoid committing with message "${getStr('message')}" — the user undid this commit.`;
            }
            case 'renameSymbol': {
                const oldName = getStr('oldName', undefined, '?');
                const newName = getStr('newName', undefined, '?');
                return `Avoid renaming ${oldName} to ${newName} — the user undid this rename.`;
            }
            case 'deleteFile': {
                return `Avoid deleting ${getStr('path', undefined, 'unknown file')} — the user undid this deletion.`;
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
     * Returns an object with both arrays for the system prompt.
     */
    async getPatterns(): Promise<{
        corrections: string[];
        positives: string[];
    }> {
        const allEntries = await memory.list({ tag: 'correction' });
        const positiveEntries = await memory.list({ tag: 'positive' });

        const corrections = allEntries
            .filter((e) => {
                if (!this.currentSessionId) return true;
                return (
                    e.tags?.some(
                        (t) => t === `session:${this.currentSessionId}`,
                    ) ?? true
                );
            })
            .map((e) => e.value.replace(/^\[score=[\d.]+\]\s*/, ''));

        const positives = positiveEntries
            .filter((e) => {
                if (!this.currentSessionId) return true;
                return (
                    e.tags?.some(
                        (t) => t === `session:${this.currentSessionId}`,
                    ) ?? true
                );
            })
            .map((e) => e.value.replace(/^\[score=[\d.]+\]\s*/, ''));

        return { corrections, positives };
    }

    /**
     * Get corrections for the current session (backward-compatible).
     */
    async getCorrections(): Promise<string[]> {
        const { corrections } = await this.getPatterns();
        return corrections;
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
}

export const correctionTracker = new CorrectionTracker();
