import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-edit-file');

describe('editFileTool', () => {
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

    it('replaces oldString with newString', async () => {
        writeFileSync(join(TEST_DIR, 'test.ts'), 'const x = 1;\nconst y = 2;');
        const { editFileTool } = await import('../edit-file');
        const result = await editFileTool({
            path: 'test.ts',
            oldString: 'const x = 1;',
            newString: 'const x = 100;',
        });
        expect(result).toHaveProperty('success', true);
        expect(readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8')).toContain(
            'const x = 100;',
        );
    });

    it('returns error when oldString not found', async () => {
        writeFileSync(join(TEST_DIR, 'test.ts'), 'const x = 1;');
        const { editFileTool } = await import('../edit-file');
        const result = await editFileTool({
            path: 'test.ts',
            oldString: 'not here',
            newString: 'replacement',
        });
        expect(result).toMatchObject({
            error: 'oldString not found in file',
            retryable: true,
        });
    });
});
