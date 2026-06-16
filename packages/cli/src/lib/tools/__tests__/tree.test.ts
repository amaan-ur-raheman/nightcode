import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs/promises')>();
    return {
        ...actual,
        lstat: async (path: any, options: any) => {
            if (typeof path === 'string' && path.endsWith('z_error.txt')) {
                throw new Error('Simulated lstat failure');
            }
            return actual.lstat(path, options);
        },
    };
});

let TEST_DIR: string;

describe('treeTool', () => {
    beforeEach(() => {
        TEST_DIR = join(
            tmpdir(),
            `nightcode-test-tree-${Math.random().toString(36).substring(2, 15)}`,
        );
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

    it('correctly uses └── for the last non-null item when null entries exist at the end', async () => {
        // Create an extra file that will sort last
        writeFileSync(join(TEST_DIR, 'z_error.txt'), 'error');

        const { treeTool } = await import('../tree');
        const result = await treeTool({ path: '.', depth: 3 });

        // z_error.txt should not be in the output
        expect(result.tree).not.toContain('z_error.txt');

        // The last visible item (src/) should render with └── instead of ├──
        const lines = result.tree.split('\n');
        const srcLine = lines.find((line) => line.includes('src/'));
        expect(srcLine).toBe('└── src/');
    });
});
