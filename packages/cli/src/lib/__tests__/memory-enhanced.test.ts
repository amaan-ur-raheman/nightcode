import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memory } from '../memory';
import * as fsPromises from 'fs/promises';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('[]'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
    if ((memory as any).saveTimeout) {
        clearTimeout((memory as any).saveTimeout);
        (memory as any).saveTimeout = null;
    }
    (memory as any)._dirty = false;
});

afterEach(() => {
    if ((memory as any).saveTimeout) {
        clearTimeout((memory as any).saveTimeout);
        (memory as any).saveTimeout = null;
    }
    (memory as any)._dirty = false;
});

describe('MemoryManager — fuzzy search', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        (memory as any).entries.clear();
        (memory as any).loaded = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('finds close matches via Levenshtein distance', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('database-url', 'postgres://localhost/mydb');
        await memory.set('user-style', 'functional');

        // "databse" is 2 edits from "database" (delete 'a' at pos 4, then insert 'e')
        // But "database-url" is long. Use a short key for a clean match.
        const results = await memory.fuzzySearch('databse', 4);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.some((e) => e.key === 'database-url')).toBe(true);
    });

    it('finds exact substring with maxDist=0', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('theme', 'dark');
        await memory.set('font', 'mono');

        // "theme" distance to "theme" is 0
        const exact = await memory.fuzzySearch('theme', 0);
        expect(exact.length).toBe(1);
        expect(exact[0]!.key).toBe('theme');
    });

    it('finds typo with maxDist=2', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('theme', 'dark');

        // "thme" is 1 edit away from "theme" (missing 'e' at pos 2)
        const fuzzy = await memory.fuzzySearch('thme', 2);
        expect(fuzzy.some((e) => e.key === 'theme')).toBe(true);
    });

    it('returns empty for no matches', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('key', 'value');
        const results = await memory.fuzzySearch('zzzzzzzzz');
        expect(results).toEqual([]);
    });
});

describe('MemoryManager — TTL / expiry', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        (memory as any).entries.clear();
        (memory as any).loaded = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stores entry with TTL', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('temp-key', 'temp-value', [], 60_000);
        const value = await memory.get('temp-key');
        expect(value).toBe('temp-value');
    });

    it('evicts expired entries on access', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('expiring', 'gone soon', [], 1);

        await new Promise((r) => setTimeout(r, 10));

        const value = await memory.get('expiring');
        expect(value).toBeNull();
    });

    it('evicts expired entries on list', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('will-expire', 'bye', [], 1);
        await memory.set('permanent', 'stays', []);

        await new Promise((r) => setTimeout(r, 10));

        const entries = await memory.list();
        expect(entries.some((e) => e.key === 'will-expire')).toBe(false);
        expect(entries.some((e) => e.key === 'permanent')).toBe(true);
    });

    it('preserves existing TTL when updating without new TTL', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('ttl-key', 'v1', [], 60_000);
        await memory.set('ttl-key', 'v2', []);

        const value = await memory.get('ttl-key');
        expect(value).toBe('v2');
    });
});

describe('MemoryManager — access count tracking', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        (memory as any).entries.clear();
        (memory as any).loaded = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('increments access count on get', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('counter', 'value');

        await memory.get('counter');
        await memory.get('counter');
        await memory.get('counter');

        const entries = await memory.list();
        const entry = entries.find((e) => e.key === 'counter');
        expect(entry?.accessCount).toBe(3);
    });

    it('increments access count on search', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('search-me', 'content');

        await memory.search('search');
        await memory.search('search');

        const entries = await memory.list();
        const entry = entries.find((e) => e.key === 'search-me');
        expect(entry?.accessCount).toBe(2);
    });

    it('preserves access count on update', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('keep-count', 'v1');
        await memory.get('keep-count');
        await memory.get('keep-count');

        await memory.set('keep-count', 'v2', []);

        const entries = await memory.list();
        const entry = entries.find((e) => e.key === 'keep-count');
        expect(entry?.accessCount).toBe(2);
        expect(entry?.value).toBe('v2');
    });
});

describe('MemoryManager — stats', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        (memory as any).entries.clear();
        (memory as any).loaded = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns empty stats when no entries', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        const stats = await memory.stats();
        expect(stats.totalEntries).toBe(0);
        expect(stats.totalTags).toEqual([]);
    });

    it('reports correct stats with entries', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('a', 'val-a', ['tag1', 'tag2']);
        await memory.set('b', 'val-b', ['tag2', 'tag3']);
        await memory.get('a');
        await memory.get('a');
        await memory.get('a');
        await memory.get('b');

        const stats = await memory.stats();
        expect(stats.totalEntries).toBe(2);
        expect(stats.totalTags).toContain('tag1');
        expect(stats.totalTags).toContain('tag2');
        expect(stats.totalTags).toContain('tag3');
        expect(stats.mostAccessed?.key).toBe('a');
        expect(stats.mostAccessed?.accessCount).toBe(3);
        expect(stats.oldestEntry).toBeDefined();
        expect(stats.newestEntry).toBeDefined();
    });
});

describe('MemoryManager — debounced save', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
        (memory as any).entries.clear();
        (memory as any).loaded = false;
        (memory as any)._dirty = false;
        if ((memory as any).saveTimeout) {
            clearTimeout((memory as any).saveTimeout);
            (memory as any).saveTimeout = null;
        }
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('coalesces writes on get and flushes after delay', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        // set writes immediately
        await memory.set('key', 'val');
        expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
        vi.mocked(fsPromises.writeFile).mockClear();

        // get should only set dirty flag and schedule save, NOT write immediately
        await memory.get('key');
        expect(fsPromises.writeFile).not.toHaveBeenCalled();
        expect((memory as any)._dirty).toBe(true);

        // advancing timers should trigger the save
        await vi.advanceTimersByTimeAsync(1000);
        expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
        expect((memory as any)._dirty).toBe(false);
    });

    it('manually flushes via saveIfDirty when dirty', async () => {
        const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('key', 'val');
        vi.mocked(fsPromises.writeFile).mockClear();

        await memory.get('key');
        expect(fsPromises.writeFile).not.toHaveBeenCalled();

        await memory.saveIfDirty();
        expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
        expect((memory as any)._dirty).toBe(false);
    });
});
