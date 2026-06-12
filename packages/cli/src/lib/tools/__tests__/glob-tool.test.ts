import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-glob');

describe('globTool', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
        vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
        writeFileSync(join(TEST_DIR, 'a.ts'), 'export const a = 1;');
        writeFileSync(join(TEST_DIR, 'b.ts'), 'export const b = 2;');
        writeFileSync(join(TEST_DIR, 'c.js'), 'module.exports = {};');
        mkdirSync(join(TEST_DIR, 'node_modules'), { recursive: true });
        writeFileSync(join(TEST_DIR, 'node_modules/pkg.ts'), 'ignored');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            const { rmSync } = require('fs');
            rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {}
    });

    it('returns matching files for a glob pattern', async () => {
        const { globTool } = await import('../glob');
        const result = await globTool({ pattern: '*.ts' });
        expect(result.files).toContain('a.ts');
        expect(result.files).toContain('b.ts');
        expect(result.files).not.toContain('c.js');
    });

    it('excludes node_modules by default', async () => {
        const { globTool } = await import('../glob');
        const result = await globTool({ pattern: '**/*.ts' });
        expect(
            result.files.some((f: string) => f.includes('node_modules')),
        ).toBe(false);
    });

    it('returns empty array when no matches', async () => {
        const { globTool } = await import('../glob');
        const result = await globTool({ pattern: '*.py' });
        expect(result.files).toEqual([]);
    });
});
