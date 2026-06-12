import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-move-file');

describe('moveFileTool', () => {
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

    it('moves a file to a new location', async () => {
        writeFileSync(join(TEST_DIR, 'source.txt'), 'content');
        const { moveFileTool } = await import('../move-file');
        const result = await moveFileTool({
            from: 'source.txt',
            to: 'dest.txt',
        });
        expect(result).toHaveProperty('success', true);
        expect(existsSync(join(TEST_DIR, 'source.txt'))).toBe(false);
        expect(existsSync(join(TEST_DIR, 'dest.txt'))).toBe(true);
        expect(readFileSync(join(TEST_DIR, 'dest.txt'), 'utf-8')).toBe(
            'content',
        );
    });

    it('creates parent directories for destination', async () => {
        writeFileSync(join(TEST_DIR, 'source.txt'), 'content');
        const { moveFileTool } = await import('../move-file');
        const result = await moveFileTool({
            from: 'source.txt',
            to: 'nested/dest.txt',
        });
        expect(result).toHaveProperty('success', true);
        expect(existsSync(join(TEST_DIR, 'nested/dest.txt'))).toBe(true);
    });
});
