import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-list-dir');

describe('listDirectoryTool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
        vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
        writeFileSync(join(TEST_DIR, 'file.txt'), 'data');
        mkdirSync(join(TEST_DIR, 'subdir'), { recursive: true });
        writeFileSync(join(TEST_DIR, '.hidden'), 'hidden');
        writeFileSync(join(TEST_DIR, 'node_modules'), 'ignored');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            const { rmSync } = require('fs');
            rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {}
    });

    it('lists files and directories sorted with dirs first', async () => {
        const { listDirectoryTool } = await import('../list-directory');
        const result = await listDirectoryTool({ path: '.' });
        expect(result.entries.length).toBeGreaterThanOrEqual(1);
        expect(
            result.entries.some(
                (e: any) => e.name === 'file.txt' && e.type === 'file',
            ),
        ).toBe(true);
        expect(
            result.entries.some(
                (e: any) => e.name === 'subdir' && e.type === 'directory',
            ),
        ).toBe(true);
    });

    it('filters out dotfiles', async () => {
        const { listDirectoryTool } = await import('../list-directory');
        const result = await listDirectoryTool({ path: '.' });
        expect(result.entries.some((e: any) => e.name === '.hidden')).toBe(
            false,
        );
    });

    it('filters out node_modules', async () => {
        const { listDirectoryTool } = await import('../list-directory');
        const result = await listDirectoryTool({ path: '.' });
        expect(result.entries.some((e: any) => e.name === 'node_modules')).toBe(
            false,
        );
    });
});
