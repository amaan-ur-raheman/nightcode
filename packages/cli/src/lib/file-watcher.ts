import { watch, type FSWatcher, statSync } from 'fs';
import { join, extname } from 'path';
import { debug } from './debug';
import { globCache } from './glob-cache';
import { IGNORE } from './tools/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FileChangeType = 'created' | 'modified' | 'deleted' | 'renamed';

export interface FileChangeEvent {
    /** Relative path to the changed file */
    filePath: string;
    /** Type of change */
    changeType: FileChangeType;
    /** Timestamp of the change */
    timestamp: number;
    /** Whether this change was made by the AI (should be ignored) */
    isInternal: boolean;
}

export interface FileWatcherConfig {
    /** Enable/disable watching */
    enabled: boolean;
    /** Debounce interval in ms (rapid events are coalesced) */
    debounceMs: number;
    /** Directories to ignore (relative to project root) */
    ignorePatterns: string[];
    /** File extensions to watch (empty = all) */
    watchExtensions: string[];
    /** Max changes to track before oldest are evicted */
    maxTrackedChanges: number;
}

export type FileWatcherListener = (changes: FileChangeEvent[]) => void;

// ─── Ignored patterns ───────────────────────────────────────────────────────

const EXTRA_IGNORE_FILES = new Set([
    'bun.lockb',
    'bun.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
]);

// ─── Watcher implementation ─────────────────────────────────────────────────

class FileWatcher {
    private watcher: FSWatcher | null = null;
    private config: FileWatcherConfig = {
        enabled: true,
        debounceMs: 300,
        ignorePatterns: [...IGNORE],
        watchExtensions: [],
        maxTrackedChanges: 200,
    };

    private recentChanges: FileChangeEvent[] = [];
    private pendingEvents: Map<
        string,
        { changeType: FileChangeType; timestamp: number }
    > = new Map();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private listeners: Set<FileWatcherListener> = new Set();
    private watchedPaths: Set<string> = new Set();
    private cwd: string = process.cwd();

    // Track internal modifications so we can ignore them
    private internalPaths: Set<string> = new Set();
    private internalPathTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Start watching the project directory for changes.
     */
    start(cwd?: string): void {
        if (this.watcher) return;

        if (cwd) this.cwd = cwd;

        try {
            this.watcher = watch(
                this.cwd,
                {
                    recursive: true,
                    persistent: true,
                },
                (eventType, filename) => {
                    if (!filename) return;
                    if (!this.config.enabled) return;

                    // Check ignore patterns
                    if (this.isIgnored(filename)) return;

                    // Check extension filter
                    if (this.config.watchExtensions.length > 0) {
                        const ext = extname(filename).toLowerCase();
                        if (!this.config.watchExtensions.includes(ext)) return;
                    }

                    const changeType: FileChangeType =
                        eventType === 'rename' ? 'deleted' : 'modified';

                    this.pendingEvents.set(filename, {
                        changeType,
                        timestamp: Date.now(),
                    });

                    this.scheduleFlush();
                },
            );

            debug.log('file-watcher', `Started watching: ${this.cwd}`);
        } catch (err) {
            debug.log('file-watcher', `Failed to start watcher: ${err}`);
        }
    }

    /**
     * Stop watching.
     */
    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.internalPathTimer) {
            clearTimeout(this.internalPathTimer);
            this.internalPathTimer = null;
        }
        this.pendingEvents.clear();
        this.watchedPaths.clear();
        debug.log('file-watcher', 'Stopped watching');
    }

    /**
     * Record that a file was modified internally (by the AI).
     * Events for these files will be ignored for a short period.
     */
    recordInternalChange(filePath: string): void {
        // Normalize to relative path for consistent matching with fs.watch events
        const relativePath = filePath.startsWith(this.cwd)
            ? filePath.slice(this.cwd.length + 1)
            : filePath;
        this.internalPaths.add(relativePath);
        this.internalPaths.add(filePath); // Also keep absolute for safety

        // Clear old internal paths after a delay
        if (this.internalPathTimer) {
            clearTimeout(this.internalPathTimer);
        }
        this.internalPathTimer = setTimeout(() => {
            this.internalPaths.clear();
            this.internalPathTimer = null;
        }, 2000);
    }

    /**
     * Subscribe to file change events.
     * Returns an unsubscribe function.
     */
    onChange(listener: FileWatcherListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Get all changes since the last check.
     * If `since` is provided, only returns changes after that timestamp.
     */
    getChanges(since?: number): FileChangeEvent[] {
        if (since) {
            return this.recentChanges.filter((c) => c.timestamp > since);
        }
        return [...this.recentChanges];
    }

    /**
     * Get the count of unreviewed changes.
     */
    getPendingCount(): number {
        return this.recentChanges.length;
    }

    /**
     * Mark all current changes as reviewed (clears the list).
     */
    clearChanges(): void {
        this.recentChanges = [];
    }

    /**
     * Update configuration.
     */
    updateConfig(config: Partial<FileWatcherConfig>): void {
        this.config = { ...this.config, ...config };
        debug.log('file-watcher', 'Config updated', this.config);
    }

    getConfig(): Readonly<FileWatcherConfig> {
        return this.config;
    }

    /**
     * Check if the watcher is currently active.
     */
    isWatching(): boolean {
        return this.watcher !== null;
    }

    // ─── Private methods ───────────────────────────────────────────────────

    private scheduleFlush(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.flushPendingEvents();
        }, this.config.debounceMs);
    }

    private flushPendingEvents(): void {
        if (this.pendingEvents.size === 0) return;

        const changes: FileChangeEvent[] = [];

        for (const [filename, event] of this.pendingEvents) {
            // Check if this was an internal change
            const isInternal =
                this.internalPaths.has(filename) ||
                this.internalPaths.has(join(this.cwd, filename));

            // Try to determine if the file still exists (to distinguish delete from rename)
            let changeType = event.changeType;
            try {
                statSync(join(this.cwd, filename));
                // File exists — if we thought it was deleted, it was actually a rename
                if (changeType === 'deleted') {
                    changeType = 'modified';
                }
            } catch {
                // File doesn't exist — confirmed deletion
                changeType = 'deleted';
            }

            changes.push({
                filePath: filename,
                changeType,
                timestamp: event.timestamp,
                isInternal,
            });
        }

        this.pendingEvents.clear();

        // Filter out internal changes
        const externalChanges = changes.filter((c) => !c.isInternal);

        if (externalChanges.length > 0) {
            // Add to recent changes
            this.recentChanges.push(...externalChanges);

            // Evict old changes if over limit
            if (this.recentChanges.length > this.config.maxTrackedChanges) {
                this.recentChanges = this.recentChanges.slice(
                    -this.config.maxTrackedChanges,
                );
            }

            // Invalidate glob cache for affected files
            for (const change of externalChanges) {
                globCache.invalidateFile(change.filePath);
            }

            debug.log(
                'file-watcher',
                `Detected ${externalChanges.length} external change(s)`,
                {
                    files: externalChanges.map(
                        (c) => `${c.changeType}: ${c.filePath}`,
                    ),
                },
            );

            // Notify listeners
            this.notifyListeners(externalChanges);
        }
    }

    private notifyListeners(changes: FileChangeEvent[]): void {
        for (const listener of this.listeners) {
            try {
                listener(changes);
            } catch (err) {
                debug.log('file-watcher', `Listener error: ${err}`);
            }
        }
    }

    private isIgnored(filename: string): boolean {
        // Check if any path component matches an ignored directory
        const parts = filename.split('/');
        if (parts.some((part) => IGNORE.has(part))) return true;
        // Check for extra ignored lock files
        const basename = parts[parts.length - 1] ?? '';
        if (EXTRA_IGNORE_FILES.has(basename)) return true;
        // Check for hidden files/directories (starts with .)
        if (parts.some((part) => part.startsWith('.') && part.length > 1))
            return true;
        return false;
    }
}

// Export singleton
export const fileWatcher = new FileWatcher();
