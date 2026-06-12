import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-create-dir');

describe('createDirectoryTool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
        vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            const { rmSync } = require('fs');
            rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {}
    });

    it('creates a directory', async () => {
        const { createDirectoryTool } = await import('../create-directory');
        const result = await createDirectoryTool({ path: 'new-dir' });
        expect(result).toHaveProperty('success', true);
        expect(existsSync(join(TEST_DIR, 'new-dir'))).toBe(true);
    });

    it('creates nested directories recursively', async () => {
        const { createDirectoryTool } = await import('../create-directory');
        const result = await createDirectoryTool({ path: 'a/b/c/d' });
        expect(result).toHaveProperty('success', true);
        expect(existsSync(join(TEST_DIR, 'a/b/c/d'))).toBe(true);
    });

    it('does not fail if directory already exists', async () => {
        const { createDirectoryTool } = await import('../create-directory');
        const result = await createDirectoryTool({ path: '.' });
        expect(result).toHaveProperty('success', true);
    });
});
