import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('processManageTool', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns error for invalid PID in kill', async () => {
        const { processManageTool } = await import('../process-manage');
        const result = await processManageTool({ action: 'kill', pid: 0 });
        expect(result.stdout).toContain('valid PID');
    });

    it('returns no-matching for empty list', async () => {
        const originalBun = (globalThis as any).Bun;
        const mockProc = {
            stdout: new ReadableStream({
                start(controller: ReadableStreamDefaultController) {
                    controller.enqueue(new TextEncoder().encode(''));
                    controller.close();
                },
            }),
            stderr: new ReadableStream({
                start(controller: ReadableStreamDefaultController) {
                    controller.enqueue(new TextEncoder().encode(''));
                    controller.close();
                },
            }),
            exited: Promise.resolve(1),
        };
        (globalThis as any).Bun = {
            spawn: vi.fn().mockReturnValue(mockProc),
        };

        try {
            const { processManageTool } = await import('../process-manage');
            const result = await processManageTool({ action: 'list' });
            expect(result.stdout).toContain('No matching processes found');
        } finally {
            (globalThis as any).Bun = originalBun;
        }
    });

    it('lists running dev processes', async () => {
        const originalBun = (globalThis as any).Bun;
        const mockProc = {
            stdout: new ReadableStream({
                start(controller: ReadableStreamDefaultController) {
                    controller.enqueue(
                        new TextEncoder().encode(
                            'user  1234  0.5  1.2 node server.js',
                        ),
                    );
                    controller.close();
                },
            }),
            stderr: new ReadableStream({
                start(controller: ReadableStreamDefaultController) {
                    controller.enqueue(new TextEncoder().encode(''));
                    controller.close();
                },
            }),
            exited: Promise.resolve(0),
        };
        (globalThis as any).Bun = {
            spawn: vi.fn().mockReturnValue(mockProc),
        };

        try {
            const { processManageTool } = await import('../process-manage');
            const result = await processManageTool({ action: 'list' });
            expect(result).toHaveProperty('stdout');
        } finally {
            (globalThis as any).Bun = originalBun;
        }
    });
});
