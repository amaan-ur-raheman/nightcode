/**
 * Error Pattern Tracker
 *
 * Detects repeated error patterns across tool calls and injects
 * suggestions after 3+ similar errors. Helps the agent learn from
 * its mistakes and avoid repeating the same failures.
 */

const PATTERN_THRESHOLD = 3; // Min errors before suggesting
const PATTERN_WINDOW_MS = 5 * 60_000; // 5-minute window
const MAX_PATTERNS = 20; // Max patterns to track per session

interface ErrorEntry {
    pattern: string;
    timestamp: number;
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
};

class ErrorPatternTracker {
    private recentErrors: ErrorEntry[] = [];
    private suggestions: string[] = [];

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
        this.recentErrors.push({ pattern, timestamp: now });

        // Prune old entries outside the window
        this.recentErrors = this.recentErrors.filter(
            (e) => now - e.timestamp < PATTERN_WINDOW_MS,
        );

        // Count occurrences of this pattern
        const count = this.recentErrors.filter(
            (e) => e.pattern === pattern,
        ).length;

        if (count >= PATTERN_THRESHOLD) {
            const suggestion = this.getSuggestion(pattern);
            // Don't repeat the same suggestion
            if (!this.suggestions.includes(suggestion)) {
                this.suggestions.push(suggestion);
                // Cap suggestion list
                if (this.suggestions.length > MAX_PATTERNS) {
                    this.suggestions.shift();
                }
                return suggestion;
            }
        }

        return null;
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
    }

    private extractPattern(message: string): string | null {
        const trimmed = message.trim();
        if (!trimmed) {
            return null;
        }
        for (const keyword of Object.keys(ERROR_SUGGESTIONS)) {
            const hasNonWord = /[^\w]/.test(keyword);
            const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const patternStr = hasNonWord ? escaped : `\\b${escaped}\\b`;
            const regex = new RegExp(patternStr, 'i');
            if (regex.test(trimmed)) {
                return keyword;
            }
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
