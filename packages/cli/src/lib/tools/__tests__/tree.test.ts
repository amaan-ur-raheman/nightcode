import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-tree');

describe('treeTool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
        vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
        mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
        writeFileSync(join(TEST_DIR, 'src/index.ts'), 'export {};');
        mkdirSync(join(TEST_DIR, 'src/lib'), { recursive: true });
        writeFileSync(join(TEST_DIR, 'src/lib/utils.ts'), 'export {};');
        writeFileSync(join(TEST_DIR, 'README.md'), '# Test');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            const { rmSync } = require('fs');
            rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {}
    });

    it('returns a tree string with directory structure', async () => {
        const { treeTool } = await import('../tree');
        const result = await treeTool({ path: '.', depth: 3 });
        expect(result.tree).toContain('src/');
        expect(result.tree).toContain('index.ts');
        expect(result.tree).toContain('README.md');
    });

    it('respects depth limit', async () => {
        const { treeTool } = await import('../tree');
        const result = await treeTool({ path: '.', depth: 1 });
        expect(result.tree).toContain('src/');
        expect(result.tree).toContain('README.md');
        // With depth 1, nested files should not appear
        expect(result.tree).not.toContain('utils.ts');
    });
});
