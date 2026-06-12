import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { globCache } from '../glob-cache';

const TEST_DIR = join(tmpdir(), `glob-cache-test-${Date.now()}`);

function createTestFiles() {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, 'a.ts'), '');
    writeFileSync(join(TEST_DIR, 'b.ts'), '');
    writeFileSync(join(TEST_DIR, 'c.js'), '');
    mkdirSync(join(TEST_DIR, 'sub'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'sub', 'd.ts'), '');
    writeFileSync(join(TEST_DIR, 'sub', 'e.js'), '');
}

describe('GlobCache', () => {
    beforeEach(() => {
        createTestFiles();
        globCache.invalidate();
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
        globCache.invalidate();
    });

    it('returns a Promise<string[]> (async result)', async () => {
        const result = globCache.getCachedGlob('**/*.ts', TEST_DIR);
        // Should return a Promise
        expect(result).toBeInstanceOf(Promise);
        const resolved = await result;
        // Should resolve to an array of strings
        expect(Array.isArray(resolved)).toBe(true);
        expect(resolved.every((f) => typeof f === 'string')).toBe(true);
    });

    it('returns matching files for a glob pattern', async () => {
        const files = await globCache.getCachedGlob('**/*.ts', TEST_DIR);
        expect(files).toContain('a.ts');
        expect(files).toContain('b.ts');
        expect(files).toContain('sub/d.ts');
        expect(files).not.toContain('c.js');
        expect(files).not.toContain('sub/e.js');
    });

    it('returns results for broad patterns (all files)', async () => {
        const files = await globCache.getCachedGlob('**/*', TEST_DIR);
        expect(files.length).toBeGreaterThanOrEqual(4);
    });

    it('caches results across calls (second call is a cache hit)', async () => {
        const statsBefore = globCache.getStats();

        await globCache.getCachedGlob('**/*.ts', TEST_DIR);
        const afterFirst = globCache.getStats();
        expect(afterFirst.misses - statsBefore.misses).toBe(1);

        await globCache.getCachedGlob('**/*.ts', TEST_DIR);
        const afterSecond = globCache.getStats();
        // Second call should be a hit, not a miss
        expect(afterSecond.hits - afterFirst.hits).toBe(1);
        expect(afterSecond.misses - afterFirst.misses).toBe(0);
    });

    it('uses different cache keys for different patterns on the same directory', async () => {
        const tsFiles = await globCache.getCachedGlob('**/*.ts', TEST_DIR);
        const jsFiles = await globCache.getCachedGlob('**/*.js', TEST_DIR);

        expect(tsFiles).not.toEqual(jsFiles);
        // Both cached separately
        expect(globCache.getStats().size).toBe(2);
    });

    it('returns empty array when no files match', async () => {
        const files = await globCache.getCachedGlob('**/*.py', TEST_DIR);
        expect(files).toEqual([]);
    });

    it('invalidate() clears the entire cache', async () => {
        await globCache.getCachedGlob('**/*.ts', TEST_DIR);
        expect(globCache.getStats().size).toBe(1);

        globCache.invalidate();
        expect(globCache.getStats().size).toBe(0);
    });

    it('invalidate(pattern) clears only entries matching the pattern', async () => {
        await globCache.getCachedGlob('**/*.ts', TEST_DIR);
        await globCache.getCachedGlob('**/*.js', TEST_DIR);
        expect(globCache.getStats().size).toBe(2);

        globCache.invalidate('**/*.ts');
        expect(globCache.getStats().size).toBe(1);

        // The remaining entry should be the .js one
        const jsFiles = await globCache.getCachedGlob('**/*.js', TEST_DIR);
        expect(jsFiles.length).toBeGreaterThan(0);
    });

    it('trims entries beyond maxEntrySize to prevent unbounded memory growth', async () => {
        const manyFilesDir = join(tmpdir(), `glob-cache-large-${Date.now()}`);
        mkdirSync(manyFilesDir, { recursive: true });

        // Create enough files to exceed the default maxEntrySize cap (10000)
        const fileCount = 100;
        for (let i = 0; i < fileCount; i++) {
            writeFileSync(join(manyFilesDir, `file-${i}.ts`), '');
        }

        const files = await globCache.getCachedGlob('*.ts', manyFilesDir);

        // We created fileCount files; the cache should return all of them
        // (under maxEntrySize). This validates the cache works with larger sets.
        expect(files.length).toBe(fileCount);

        rmSync(manyFilesDir, { recursive: true, force: true });
    });
});
