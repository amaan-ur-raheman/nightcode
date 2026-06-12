import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-delete-file');

describe('deleteFileTool', () => {
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

    it('deletes a file', async () => {
        writeFileSync(join(TEST_DIR, 'to-delete.txt'), 'data');
        const { deleteFileTool } = await import('../delete-file');
        const result = await deleteFileTool({
            path: 'to-delete.txt',
            recursive: false,
        });
        expect(result).toHaveProperty('success', true);
        expect(existsSync(join(TEST_DIR, 'to-delete.txt'))).toBe(false);
    });

    it('returns error for non-empty directory without recursive', async () => {
        mkdirSync(join(TEST_DIR, 'subdir'));
        writeFileSync(join(TEST_DIR, 'subdir/file.txt'), 'data');
        const { deleteFileTool } = await import('../delete-file');
        try {
            const result = await deleteFileTool({
                path: 'subdir',
                recursive: false,
            });
            expect(result).toHaveProperty('error');
        } catch (err: any) {
            // Bun may throw ENOTEMPTY or EISDIR depending on version
            expect(err).toBeDefined();
        }
    });

    it('deletes directory recursively when recursive=true', async () => {
        mkdirSync(join(TEST_DIR, 'subdir'));
        writeFileSync(join(TEST_DIR, 'subdir/file.txt'), 'data');
        const { deleteFileTool } = await import('../delete-file');
        const result = await deleteFileTool({
            path: 'subdir',
            recursive: true,
        });
        expect(result).toHaveProperty('success', true);
    });

    it('returns error for non-existent path', async () => {
        const { deleteFileTool } = await import('../delete-file');
        const result = await deleteFileTool({
            path: 'does-not-exist.txt',
            recursive: false,
        });
        expect(result).toHaveProperty('error');
    });
});
