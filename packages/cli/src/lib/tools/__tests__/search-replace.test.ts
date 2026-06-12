import { describe, it, expect } from 'vitest';
import { searchReplaceTool } from '../search-replace';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { vi, afterEach, beforeEach } from 'vitest';

const TEST_DIR = join(tmpdir(), 'nightcode-test-search-replace');

describe('searchReplaceTool', () => {
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

    it('replaces pattern in matching files', async () => {
        writeFileSync(join(TEST_DIR, 'test.ts'), 'const x = 1;\nconst y = 2;');
        const result = await searchReplaceTool({
            pattern: 'const',
            replacement: 'let',
            glob: '*.ts',
            flags: '',
        });
        expect(result.filesChanged).toBeGreaterThanOrEqual(1);
    });

    it('returns 0 files changed when no matches', async () => {
        writeFileSync(join(TEST_DIR, 'test.ts'), 'const x = 1;');
        const result = await searchReplaceTool({
            pattern: 'nonexistent_thing_xyz',
            replacement: 'replaced',
            glob: '*.ts',
            flags: '',
        });
        expect(result.filesChanged).toBe(0);
    });
});
