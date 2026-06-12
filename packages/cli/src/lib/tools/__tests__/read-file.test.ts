import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-read-file');

describe('readFileTool', () => {
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

    it('reads file content with metadata', async () => {
        writeFileSync(join(TEST_DIR, 'test.ts'), 'line1\nline2\nline3');
        const { readFileTool } = await import('../read-file');
        const result = await readFileTool({ path: 'test.ts' });
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('totalLines', 3);
        expect(result.content).toContain('line1');
    });

    it('returns offset/limit sliced content', async () => {
        const lines = Array.from(
            { length: 20 },
            (_, i) => `line-${i + 1}`,
        ).join('\n');
        writeFileSync(join(TEST_DIR, 'long.ts'), lines);
        const { readFileTool } = await import('../read-file');
        const result = await readFileTool({
            path: 'long.ts',
            offset: 5,
            limit: 3,
        });
        expect(result).toHaveProperty('offset', 5);
        expect(result).toHaveProperty('limit', 3);
        expect(result.content).toContain('line-5');
        expect(result.content).toContain('line-7');
        expect(result.content).not.toContain('line-8');
    });
});
