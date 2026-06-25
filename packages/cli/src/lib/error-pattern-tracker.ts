/**
 * Error Pattern Tracker (Cross-Session)
 *
 * Detects repeated error patterns across tool calls and injects
 * suggestions after 3+ similar errors. Persists to disk so the agent
 * learns from past sessions and avoids repeating the same failures.
 *
 * Supports both hardcoded known patterns and dynamically learned patterns
 * discovered from repeated project-specific errors.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const PATTERN_THRESHOLD = 3;
const MAX_PATTERNS = 20;
const MAX_LEARNED_SUGGESTIONS = 10;

/** Half-life for pattern decay (7 days in ms). */
const DECAY_HALFLIFE_MS = 7 * 24 * 60 * 60 * 1000;

interface ErrorEntry {
    pattern: string;
    timestamp: number;
    count: number;
    lastSuggestionAt: number;
    resolved: boolean;
    /** Whether this pattern was dynamically learned (not hardcoded). */
    learned?: boolean;
}

// Known error patterns and their suggestions
const ERROR_SUGGESTIONS: Record<string, string> = {
    ENOENT: 'The file or directory does not exist. Double-check the path and try again.',
    EACCES: 'Permission denied. Try using a different path or running with appropriate permissions.',
    ECONNREFUSED:
        'Connection refused. The service may not be running. Check if the server is up.',
    ETIMEDOUT:
        'Request timed out. The server may be slow or unreachable. Try again or use a simpler request.',
    '429': 'Rate limited. Wait a moment before retrying, or reduce request frequency.',
    SyntaxError:
        'Syntax error detected. Check the code for missing brackets, semicolons, or invalid syntax.',
    TypeError:
        'Type error. Check that variables have the expected types and functions are called correctly.',
    MODULE_NOT_FOUND:
        'Module not found. Run the package manager install command or check import paths.',
    ECONNRESET:
        'Connection reset. The remote server closed the connection unexpectedly.',
    ENOTFOUND:
        'DNS resolution failed. The hostname does not exist or is unreachable.',
    ENOSPC: 'No space left on device. Free up disk space.',
    ERR_SOCKET_TIMEOUT: 'Socket timeout. Network issue or server overload.',
    EPIPE: 'Broken pipe. The receiving process has closed the connection.',
    'permission denied':
        'Permission denied. Try using a different path or running with appropriate permissions.',
    'command not found':
        'Command not found. Check the command spelling or install the required tool.',
    'no such file or directory':
        'File or directory not found. Verify the path exists.',
    'cannot find module':
        'Module not found. Run the package manager install command or check import paths.',
    'typeerror: cannot read properties':
        'Reading a property of undefined. Check that the variable is defined before accessing its properties.',
    'unexpected token':
        'Syntax error. Check for missing brackets, commas, or incorrect syntax.',
    'maximum call stack size exceeded':
        'Infinite recursion detected. Check for missing base cases in recursive functions.',
    'heap out of memory':
        'JavaScript heap out of memory. Try reducing memory usage or increase Node memory limit.',
};

class ErrorPatternTracker {
    private recentErrors: ErrorEntry[] = [];
    private suggestions: string[] = [];
    private learnedSuggestions: string[] = [];
    private persistPath: string;

    constructor(persistPath?: string) {
        this.persistPath =
            persistPath ??
            (process.env.NODE_ENV === 'test' || process.env.VITEST
                ? ':memory:'
                : join(homedir(), '.nightcode', 'error-patterns.json'));
        this.loadFromDisk();
    }

    private async loadFromDisk(): Promise<void> {
        if (this.persistPath === ':memory:') return;
        try {
            if (existsSync(this.persistPath)) {
                const { readFileSync } = await import('fs');
                const raw = readFileSync(this.persistPath, 'utf-8');
                const data = JSON.parse(raw) as {
                    recentErrors?: ErrorEntry[];
                    learnedSuggestions?: string[];
                };
                if (Array.isArray(data.recentErrors)) {
                    // Filter out decayed entries on load
                    const now = Date.now();
                    this.recentErrors = data.recentErrors.filter((e) => {
                        const age = now - e.timestamp;
                        const decay = Math.pow(0.5, age / DECAY_HALFLIFE_MS);
                        return decay > 0.01; // prune if < 1% strength
                    });
                }
                if (Array.isArray(data.learnedSuggestions)) {
                    this.learnedSuggestions = data.learnedSuggestions;
                }
            }
        } catch {
            // Corrupted file, start fresh
            this.recentErrors = [];
            this.learnedSuggestions = [];
        }
    }

    private async saveToDisk(): Promise<void> {
        if (this.persistPath === ':memory:') return;
        try {
            const dir = dirname(this.persistPath);
            if (!existsSync(dir)) {
                const { mkdirSync } = await import('fs');
                mkdirSync(dir, { recursive: true });
            }
            const { writeFileSync } = await import('fs');
            writeFileSync(
                this.persistPath,
                JSON.stringify(
                    {
                        recentErrors: this.recentErrors,
                        learnedSuggestions: this.learnedSuggestions,
                    },
                    null,
                    2,
                ),
                'utf-8',
            );
        } catch {
            // Non-critical — fail silently
        }
    }

    /** Record an error and return any suggestion if a pattern is detected. */
    record(error: unknown): string | null {
        const message = String(
            error && typeof error === 'object' && 'message' in error
                ? ((error as { message: unknown }).message ?? '')
                : (error ?? ''),
        ).toLowerCase();
        const pattern = this.extractPattern(message);
        if (!pattern) return null;

        const now = Date.now();

        // Find or create entry
        let entry = this.recentErrors.find((e) => e.pattern === pattern);
        const isKnown = pattern in ERROR_SUGGESTIONS;
        if (entry) {
            entry.count++;
            entry.timestamp = now;
        } else {
            entry = {
                pattern,
                timestamp: now,
                count: 1,
                lastSuggestionAt: 0,
                resolved: false,
                learned: !isKnown,
            };
            this.recentErrors.push(entry);
        }

        // Prune decayed entries
        this.recentErrors = this.recentErrors.filter((e) => {
            if (e.pattern === pattern) return true;
            const age = now - e.timestamp;
            const decay = Math.pow(0.5, age / DECAY_HALFLIFE_MS);
            return decay > 0.01;
        });

        // Cap patterns
        if (this.recentErrors.length > MAX_PATTERNS) {
            this.recentErrors.sort((a, b) => b.count - a.count);
            this.recentErrors = this.recentErrors.slice(0, MAX_PATTERNS);
        }

        // Count occurrences of this pattern (with decay weighting)
        const count = this.recentErrors
            .filter((e) => e.pattern === pattern)
            .reduce((sum, e) => {
                const age = now - e.timestamp;
                const decay = Math.pow(0.5, age / DECAY_HALFLIFE_MS);
                return sum + Math.max(1, Math.round(e.count * decay));
            }, 0);

        if (count >= PATTERN_THRESHOLD && !entry.resolved) {
            const suggestion = this.getSuggestion(pattern);
            // Don't repeat the same suggestion too frequently (at least 60s apart)
            if (
                !this.suggestions.includes(suggestion) &&
                now - entry.lastSuggestionAt > 60_000
            ) {
                this.suggestions.push(suggestion);
                entry.lastSuggestionAt = now;
                if (this.suggestions.length > MAX_PATTERNS) {
                    this.suggestions.shift();
                }
                // Learn the pattern for future sessions
                if (!isKnown && !this.learnedSuggestions.includes(suggestion)) {
                    this.learnedSuggestions.push(suggestion);
                    if (
                        this.learnedSuggestions.length > MAX_LEARNED_SUGGESTIONS
                    ) {
                        this.learnedSuggestions.shift();
                    }
                }
                this.saveToDisk();
                return suggestion;
            }
        }

        this.saveToDisk();
        return null;
    }

    /** Mark a pattern as resolved (user fixed it). */
    markResolved(pattern: string): void {
        const entry = this.recentErrors.find((e) => e.pattern === pattern);
        if (entry) {
            entry.resolved = true;
            // Fully suppress the pattern so it stops triggering suggestions
            entry.count = 0;
            // Remove any active suggestions for this pattern
            const suggestion = this.getSuggestion(pattern);
            this.suggestions = this.suggestions.filter((s) => s !== suggestion);
            this.saveToDisk();
        }
    }

    /** Get all accumulated suggestions. */
    getSuggestions(): string[] {
        return [...this.suggestions];
    }

    /** Get a formatted suggestions block for injection into prompts. */
    formatSuggestionsForPrompt(): string {
        const allSuggestions = [...this.suggestions];
        if (allSuggestions.length === 0) return '';
        return (
            '\n\n### [WARNING] Error Patterns Detected\n' +
            'You have encountered these errors repeatedly. Consider these suggestions:\n\n' +
            allSuggestions.map((s) => `- ${s}`).join('\n')
        );
    }

    /** Clear all tracked errors and suggestions. */
    clear(): void {
        this.recentErrors = [];
        this.suggestions = [];
        this.saveToDisk();
    }

    /** Get top patterns with their strength (for diagnostics). */
    getTopPatterns(limit = 5): Array<{
        pattern: string;
        count: number;
        strength: number;
        learned: boolean;
    }> {
        const now = Date.now();
        return this.recentErrors
            .filter((e) => !e.resolved)
            .map((e) => {
                const age = now - e.timestamp;
                const decay = Math.pow(0.5, age / DECAY_HALFLIFE_MS);
                return {
                    pattern: e.pattern,
                    count: e.count,
                    strength: e.count * decay,
                    learned: e.learned ?? false,
                };
            })
            .sort((a, b) => b.strength - a.strength)
            .slice(0, limit);
    }

    private extractPattern(message: string): string | null {
        const trimmed = message.trim();
        if (!trimmed) {
            return null;
        }
        // Check known patterns first
        for (const keyword of Object.keys(ERROR_SUGGESTIONS)) {
            const hasNonWord = /[^\w]/.test(keyword);
            const escaped = keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const patternStr = hasNonWord ? escaped : `\\b${escaped}\\b`;
            const regex = new RegExp(patternStr, 'i');
            if (regex.test(trimmed)) {
                return keyword;
            }
        }
        // Fallback: extract error code pattern (e.g., ERR_SOMETHING)
        const codeMatch = trimmed.match(/\b(ERR_[A-Z_]+)\b/);
        if (codeMatch?.[1]) {
            return codeMatch[1];
        }
        // Learn new patterns: extract first line as a normalized pattern
        const firstLine = trimmed.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 5 && firstLine.length < 200) {
            // Normalize: lowercase, collapse whitespace
            const normalized = firstLine.replace(/\s+/g, ' ').slice(0, 100);
            return `learned:${normalized}`;
        }
        return null;
    }

    private getSuggestion(pattern: string): string {
        return (
            ERROR_SUGGESTIONS[pattern] ??
            `Repeated error: "${pattern.slice(0, 80)}". Try a different approach or check the error details.`
        );
    }
}

export { ErrorPatternTracker };

/**
 * Module-scoped singleton instance.
 * Persists across calls within the same process so error suggestions
 * accumulate rather than being lost on every fresh instantiation.
 */
export const errorPatternTracker = new ErrorPatternTracker();
