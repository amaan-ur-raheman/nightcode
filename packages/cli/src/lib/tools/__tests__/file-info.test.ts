import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';

const tmpDir = join(import.meta.dirname, '__tmp_fileinfo');

describe('fileInfoTool', () => {
    let fileInfoTool: typeof import('../file-info').fileInfoTool;

    beforeEach(async () => {
        await mkdir(tmpDir, { recursive: true });
        await writeFile(join(tmpDir, 'test.txt'), 'hello\nworld\n');
        vi.resetModules();
        ({ fileInfoTool } = await import('../file-info'));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('returns file info with expected fields', async () => {
        const result = await fileInfoTool({ path: join(tmpDir, 'test.txt') });
        expect(result).toHaveProperty('name', 'test.txt');
        expect(result).toHaveProperty('isDirectory', false);
        expect(result).toHaveProperty('size');
        expect(result).toHaveProperty('lineCount', 2);
        expect(result).toHaveProperty('modified');
    });

    it('returns directory info', async () => {
        const result = await fileInfoTool({ path: tmpDir });
        expect(result).toHaveProperty('isDirectory', true);
        expect(result).toHaveProperty('size');
        expect(result).not.toHaveProperty('lineCount');
    });

    it('counts lines for single-line file', async () => {
        await writeFile(join(tmpDir, 'single.txt'), 'no newline');
        const result = await fileInfoTool({ path: join(tmpDir, 'single.txt') });
        expect(result).toHaveProperty('lineCount', 1);
    });

    it('counts lines for empty file', async () => {
        await writeFile(join(tmpDir, 'empty.txt'), '');
        const result = await fileInfoTool({ path: join(tmpDir, 'empty.txt') });
        expect(result).toHaveProperty('lineCount', 0);
    });
});
