import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-outline');

describe('getOutlineTool', () => {
    beforeEach(() => {
        vi.resetModules();
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

    it('extracts class, function, and const symbols', async () => {
        writeFileSync(
            join(TEST_DIR, 'code.ts'),
            [
                'export class MyClass {',
                '  method() {}',
                '}',
                'export function myFunc() {}',
                'export const myConst = 42;',
                'export type MyType = string;',
                'export interface MyInterface {',
                '  prop: string;',
                '}',
            ].join('\n'),
        );

        const { getOutlineTool } = await import('../get-outline');
        const result = await getOutlineTool({ path: 'code.ts' });
        expect(result.symbols.length).toBeGreaterThanOrEqual(3);
        expect(
            result.symbols.some(
                (s: any) => s.kind === 'class' && s.name === 'MyClass',
            ),
        ).toBe(true);
        expect(
            result.symbols.some(
                (s: any) => s.kind === 'function' && s.name === 'myFunc',
            ),
        ).toBe(true);
        expect(
            result.symbols.some(
                (s: any) => s.kind === 'const' && s.name === 'myConst',
            ),
        ).toBe(true);
        expect(
            result.symbols.some(
                (s: any) => s.kind === 'type' && s.name === 'MyType',
            ),
        ).toBe(true);
        expect(
            result.symbols.some(
                (s: any) => s.kind === 'interface' && s.name === 'MyInterface',
            ),
        ).toBe(true);
    });

    it('returns correct line numbers', async () => {
        writeFileSync(
            join(TEST_DIR, 'lines.ts'),
            [
                '// comment',
                'export function foo() {}',
                'export function bar() {}',
            ].join('\n'),
        );

        const { getOutlineTool } = await import('../get-outline');
        const result = await getOutlineTool({ path: 'lines.ts' });
        expect(result.symbols.find((s: any) => s.name === 'foo')?.line).toBe(2);
        expect(result.symbols.find((s: any) => s.name === 'bar')?.line).toBe(3);
    });

    it('returns empty symbols for file with only non-export statements', async () => {
        writeFileSync(join(TEST_DIR, 'blank.ts'), '\n\n');
        const { getOutlineTool } = await import('../get-outline');
        const result = await getOutlineTool({ path: 'blank.ts' });
        expect(result.symbols.length).toBe(0);
    });
});
