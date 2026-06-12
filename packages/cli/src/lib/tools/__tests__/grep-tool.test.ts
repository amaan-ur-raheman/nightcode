import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('grepTool', () => {
    const originalBun = (globalThis as any).Bun;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        (globalThis as any).Bun = originalBun;
    });

    function mockBunSpawn(stdout: string, exitCode = 0) {
        const encoder = new TextEncoder();
        const mockProc = {
            stdout: new ReadableStream({
                start(controller: ReadableStreamDefaultController) {
                    controller.enqueue(encoder.encode(stdout));
                    controller.close();
                },
            }),
            stderr: new ReadableStream({
                start(controller: ReadableStreamDefaultController) {
                    controller.enqueue(encoder.encode(''));
                    controller.close();
                },
            }),
            exited: Promise.resolve(exitCode),
        };
        (globalThis as any).Bun = { spawn: vi.fn().mockReturnValue(mockProc) };
    }

    it('returns matches found by pattern', async () => {
        mockBunSpawn('/hello.ts:1:const x = hello;\n');
        const { grepTool } = await import('../grep');
        const result = await grepTool({ pattern: 'hello', path: '.' });
        expect(result.matches.length).toBeGreaterThanOrEqual(1);
        expect(result.matches[0].content).toContain('hello');
    });

    it('returns no matches for nonexistent pattern', async () => {
        mockBunSpawn('');
        const { grepTool } = await import('../grep');
        const result = await grepTool({ pattern: 'zzzzzznotfound', path: '.' });
        expect(result.matches).toEqual([]);
        expect(result.message).toBe('No matches found');
    });

    it('returns match metadata with file, line, content', async () => {
        mockBunSpawn('/file.ts:5:some match here\n');
        const { grepTool } = await import('../grep');
        const result = await grepTool({ pattern: 'match', path: '.' });
        const match = result.matches[0];
        expect(match).toHaveProperty('file');
        expect(match).toHaveProperty('line', 5);
        expect(match).toHaveProperty('content');
    });
});
