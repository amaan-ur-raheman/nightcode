import { memory } from './memory';

/**
 * Tracks recent tool calls so that when undo is triggered,
 * we can extract a correction pattern and store it in memory.
 *
 * This creates a feedback loop: the AI makes a mistake,
 * the user undoes it, and the AI learns not to repeat it.
 *
 * Corrections are scoped to sessions to prevent cross-session contamination.
 */

interface TrackedAction {
    tool: string;
    input: unknown;
    description: string;
    timestamp: number;
    sessionId?: string;
}

const MAX_TRACKED = 20;
const CORRECTION_PREFIX = 'correction:';
const MAX_CORRECTIONS = 50;

class CorrectionTracker {
    private recentActions: TrackedAction[] = [];
    private currentSessionId?: string;

    /**
     * Set the current session ID for scoping corrections.
     */
    setSession(sessionId: string): void {
        this.currentSessionId = sessionId;
    }

    /**
     * Record a tool call for potential correction tracking.
     * Called by tools that modify files (editFile, writeFile, bash, etc.)
     */
    recordAction(tool: string, input: unknown, description: string): void {
        this.recentActions.push({
            tool,
            input,
            description,
            timestamp: Date.now(),
            sessionId: this.currentSessionId,
        });

        // Keep only the most recent actions
        if (this.recentActions.length > MAX_TRACKED) {
            this.recentActions.shift();
        }
    }

    /**
     * Called when undo is triggered. Extracts the last action
     * and stores a correction pattern in memory.
     *
     * Returns the correction pattern string, or null if nothing to correct.
     */
    async onUndo(): Promise<string | null> {
        const lastAction = this.recentActions.pop();
        if (!lastAction) return null;

        const pattern = this.generatePattern(lastAction);
        if (!pattern) return null;

        // Store in memory with correction tag and session scope
        const key = `${CORRECTION_PREFIX}${lastAction.sessionId ?? 'global'}:${Date.now()}`;
        const tags = ['correction', lastAction.tool];
        if (lastAction.sessionId) {
            tags.push(`session:${lastAction.sessionId}`);
        }
        await memory.set(key, pattern, tags);

        // Enforce max corrections limit
        await this.enforceLimit();

        return pattern;
    }

    /**
     * Generate a human-readable correction pattern from a failed action.
     */
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
                // Generic correction for unknown tools
                const desc = description || tool;
                return `Avoid the action "${desc}" (${tool}) — the user undid it.`;
            }
        }
    }

    /**
     * Keep correction count under the limit by removing oldest entries.
     */
    private async enforceLimit(): Promise<void> {
        const entries = await memory.list({ tag: 'correction' });
        if (entries.length <= MAX_CORRECTIONS) return;

        // Remove oldest corrections beyond the limit
        const toRemove = entries.slice(MAX_CORRECTIONS);
        for (const entry of toRemove) {
            await memory.delete(entry.key);
        }
    }

    /**
     * Get corrections for the current session.
     */
    async getCorrections(): Promise<string[]> {
        const entries = await memory.list({ tag: 'correction' });
        return entries
            .filter((e) => {
                // Include corrections for current session or global corrections
                if (!this.currentSessionId) return true;
                return (
                    e.tags?.some(
                        (t) => t === `session:${this.currentSessionId}`,
                    ) ?? true
                );
            })
            .map((e) => e.value);
    }

    /**
     * Clear corrections for the current session.
     */
    async clearCorrections(): Promise<number> {
        const entries = await memory.list({ tag: 'correction' });
        let count = 0;
        for (const entry of entries) {
            if (entry.key.startsWith(CORRECTION_PREFIX)) {
                // Only clear corrections for current session
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
