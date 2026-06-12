import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    mkdirSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    existsSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-create-file');

describe('createFileTool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
        // Mock process.cwd to return test dir
        vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            const { rmSync } = require('fs');
            rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {}
    });

    it('creates a new file with content', async () => {
        const { createFileTool } = await import('../create-file');
        const result = await createFileTool({
            path: 'test-file.txt',
            content: 'hello world',
        });
        expect(result).toHaveProperty('success', true);
        expect(readFileSync(join(TEST_DIR, 'test-file.txt'), 'utf-8')).toBe(
            'hello world',
        );
    });

    it('creates nested directories automatically', async () => {
        const { createFileTool } = await import('../create-file');
        const result = await createFileTool({
            path: 'deep/nested/file.ts',
            content: 'export const x = 1;',
        });
        expect(result).toHaveProperty('success', true);
        expect(existsSync(join(TEST_DIR, 'deep/nested/file.ts'))).toBe(true);
    });

    it('returns error if file already exists', async () => {
        writeFileSync(join(TEST_DIR, 'existing.txt'), 'data');
        const { createFileTool } = await import('../create-file');
        const result = await createFileTool({
            path: 'existing.txt',
            content: 'new data',
        });
        expect(result).toHaveProperty('error');
    });
});
