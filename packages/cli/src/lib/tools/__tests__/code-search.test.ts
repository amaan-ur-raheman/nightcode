import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('codeSearchTool', () => {
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

    it('finds function definitions', async () => {
        mockBunSpawn('/code.ts:1:export function greet(name) {}\n');
        const { codeSearchTool } = await import('../code-search');
        const result = await codeSearchTool({
            action: 'search',
            symbol: 'greet',
            path: '.',
        });
        expect(result).toHaveProperty('matches');
        const matches = (
            result as {
                matches: { file: string; line: number; content: string }[];
            }
        ).matches;
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(matches[0]!.content).toContain('greet');
    });

    it('returns no definitions for nonexistent symbol', async () => {
        mockBunSpawn('', 1);
        const { codeSearchTool } = await import('../code-search');
        const result = (await codeSearchTool({
            action: 'search',
            symbol: 'zzzzzzNonexistent',
            path: '.',
        })) as any;
        expect(result.matches).toEqual([]);
        expect(result.message).toBe('No definitions found');
    });

    it('returns error when grep fails with non-0/1 exit code', async () => {
        mockBunSpawn('error message', 2);
        const { codeSearchTool } = await import('../code-search');
        const result = await codeSearchTool({
            action: 'search',
            symbol: 'test',
            path: '.',
        });
        expect(result).toHaveProperty('error');
    });
});
