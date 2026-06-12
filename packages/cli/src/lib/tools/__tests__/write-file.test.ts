import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-write-file');

describe('writeFileTool', () => {
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

    it('writes content to a file and returns diff', async () => {
        const { writeFileTool } = await import('../write-file');
        const result = await writeFileTool({
            path: 'new-file.txt',
            content: 'hello world',
        });
        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('bytesWritten');
        expect(result.bytesWritten).toBeGreaterThan(0);
        expect(readFileSync(join(TEST_DIR, 'new-file.txt'), 'utf-8')).toBe(
            'hello world',
        );
    });

    it('creates parent directories', async () => {
        const { writeFileTool } = await import('../write-file');
        const result = await writeFileTool({
            path: 'deep/nested/file.ts',
            content: 'export const x = 1;',
        });
        expect(result).toHaveProperty('success', true);
    });

    it('reports no changes when writing identical content', async () => {
        writeFileSync(join(TEST_DIR, 'existing.txt'), 'content');
        const { writeFileTool } = await import('../write-file');
        const result = await writeFileTool({
            path: 'existing.txt',
            content: 'content',
        });
        expect(result).toHaveProperty('success', true);
        expect(result.bytesWritten).toBe(0);
    });

    it('generates diff for modified files', async () => {
        writeFileSync(join(TEST_DIR, 'existing.ts'), 'const x = 1;');
        const { writeFileTool } = await import('../write-file');
        const result = await writeFileTool({
            path: 'existing.ts',
            content: 'const x = 100;',
        });
        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('diff');
        expect(result.bytesWritten).toBeGreaterThan(0);
    });
});
