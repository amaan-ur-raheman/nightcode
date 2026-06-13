import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileWatcher } from '../file-watcher';

describe('FileWatcher', () => {
    beforeEach(() => {
        fileWatcher.stop();
        fileWatcher.clearChanges();
        fileWatcher.updateConfig({
            enabled: true,
            debounceMs: 50,
            ignorePatterns: ['node_modules', '.git', 'dist'],
            watchExtensions: [],
            maxTrackedChanges: 200,
        });
    });

    afterEach(() => {
        fileWatcher.stop();
        fileWatcher.clearChanges();
    });

    describe('lifecycle', () => {
        it('should report not watching initially', () => {
            expect(fileWatcher.isWatching()).toBe(false);
        });

        it('should start watching', () => {
            fileWatcher.start();
            expect(fileWatcher.isWatching()).toBe(true);
        });

        it('should stop watching', () => {
            fileWatcher.start();
            fileWatcher.stop();
            expect(fileWatcher.isWatching()).toBe(false);
        });

        it('should not start twice', () => {
            fileWatcher.start();
            fileWatcher.start(); // Should not throw
            expect(fileWatcher.isWatching()).toBe(true);
        });
    });

    describe('config management', () => {
        it('should return current config', () => {
            const config = fileWatcher.getConfig();
            expect(config).toHaveProperty('enabled');
            expect(config).toHaveProperty('debounceMs');
            expect(config).toHaveProperty('ignorePatterns');
            expect(config).toHaveProperty('watchExtensions');
            expect(config).toHaveProperty('maxTrackedChanges');
        });

        it('should update config', () => {
            fileWatcher.updateConfig({ debounceMs: 1000 });
            expect(fileWatcher.getConfig().debounceMs).toBe(1000);
        });
    });

    describe('change tracking', () => {
        it('should return empty changes initially', () => {
            const changes = fileWatcher.getChanges();
            expect(changes).toHaveLength(0);
        });

        it('should return empty pending count initially', () => {
            expect(fileWatcher.getPendingCount()).toBe(0);
        });

        it('should clear changes', () => {
            fileWatcher.clearChanges();
            expect(fileWatcher.getChanges()).toHaveLength(0);
        });
    });

    describe('listener management', () => {
        it('should subscribe to changes', () => {
            const listener = vi.fn();
            const unsub = fileWatcher.onChange(listener);
            expect(typeof unsub).toBe('function');
            unsub();
        });

        it('should unsubscribe from changes', () => {
            const listener = vi.fn();
            const unsub = fileWatcher.onChange(listener);
            unsub();
            // After unsubscribe, listener should not be called
        });
    });

    describe('internal change tracking', () => {
        it('should record internal changes', () => {
            // Should not throw
            fileWatcher.recordInternalChange('/project/src/utils.ts');
            fileWatcher.recordInternalChange('/project/src/helper.ts');
        });
    });
});
