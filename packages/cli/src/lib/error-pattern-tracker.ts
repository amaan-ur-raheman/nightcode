/**
 * Error Pattern Tracker (Cross-Session)
 *
 * Detects repeated error patterns across tool calls and injects
 * suggestions after 3+ similar errors. Persists to disk so the agent
 * learns from past sessions and avoids repeating the same failures.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const PATTERN_THRESHOLD = 3;
const PATTERN_WINDOW_MS = 5 * 60_000;
const MAX_PATTERNS = 20;
const MAX_PER_PATTERN = 10;

/** Half-life for pattern decay (7 days in ms). */
const DECAY_HALFLIFE_MS = 7 * 24 * 60 * 60 * 1000;

interface ErrorEntry {
    pattern: string;
    timestamp: number;
    count: number;
    lastSuggestionAt: number;
    resolved: boolean;
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
    private persistPath: string;

    constructor(persistPath?: string) {
        this.persistPath = persistPath ?? (
            (process.env.NODE_ENV === 'test' || process.env.VITEST)
                ? ':memory:'
                : join(homedir(), '.nightcode', 'error-patterns.json')
        );
        this.loadFromDisk();
    }

    private loadFromDisk(): void {
        if (this.persistPath === ':memory:') return;
        try {
            if (existsSync(this.persistPath)) {
                const raw = readFileSync(this.persistPath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    // Filter out decayed entries on load
                    const now = Date.now();
                    this.recentErrors = data.filter((e) => {
                        const age = now - e.timestamp;
                        const decay = Math.pow(0.5, age / DECAY_HALFLIFE_MS);
                        return decay > 0.01; // prune if < 1% strength
                    });
                }
            }
        } catch {
            // Corrupted file, start fresh
            this.recentErrors = [];
        }
    }

    private saveToDisk(): void {
        if (this.persistPath === ':memory:') return;
        try {
            const dir = dirname(this.persistPath);
            if (!existsSync(dir)) {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('fs').mkdirSync(dir, { recursive: true });
            }
            writeFileSync(
                this.persistPath,
                JSON.stringify(this.recentErrors, null, 2),
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
            };
            this.recentErrors.push(entry);
        }

        // Prune old entries outside the window and decayed entries
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
            entry.count = Math.max(0, entry.count - 2);
            this.saveToDisk();
        }
    }

    /** Get all accumulated suggestions. */
    getSuggestions(): string[] {
        return [...this.suggestions];
    }

    /** Get a formatted suggestions block for injection into prompts. */
    formatSuggestionsForPrompt(): string {
        if (this.suggestions.length === 0) return '';
        return (
            '\n\n### [WARNING] Error Patterns Detected\n' +
            'You have encountered these errors repeatedly. Consider these suggestions:\n\n' +
            this.suggestions.map((s) => `- ${s}`).join('\n')
        );
    }

    /** Clear all tracked errors and suggestions. */
    clear(): void {
        this.recentErrors = [];
        this.suggestions = [];
        this.saveToDisk();
    }

    /** Get top patterns with their strength (for diagnostics). */
    getTopPatterns(
        limit = 5,
    ): Array<{ pattern: string; count: number; strength: number }> {
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
            const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
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
        return null;
    }

    private getSuggestion(pattern: string): string {
        return (
            ERROR_SUGGESTIONS[pattern] ??
            'Review the error message and try a different approach.'
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
