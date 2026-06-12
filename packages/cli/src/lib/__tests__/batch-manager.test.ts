import { describe, it, expect, vi } from 'vitest';

// We need a fresh module for each test
describe('BatchManager', () => {
    it('executes non-batchable tools immediately', async () => {
        const { batchManager } = await import('../batch-manager');
        const executor = vi.fn().mockResolvedValue('result');
        const result = await batchManager.addRequest(
            'bash',
            { command: 'echo hi' },
            executor,
            'BUILD',
        );
        expect(result).toBe('result');
        expect(executor).toHaveBeenCalledTimes(1);
    });

    it('batches readFile requests', async () => {
        const { batchManager } = await import('../batch-manager');
        const executor = vi.fn().mockResolvedValue('content');
        // Start two readFile requests — they'll be batched
        const promise1 = batchManager.addRequest(
            'readFile',
            { path: 'a.ts' },
            executor,
            'BUILD',
        );
        const promise2 = batchManager.addRequest(
            'readFile',
            { path: 'b.ts' },
            executor,
            'BUILD',
        );
        // Both should resolve
        const [r1, r2] = await Promise.all([promise1, promise2]);
        expect(r1).toBe('content');
        expect(r2).toBe('content');
    });

    it('toggles batching on and off', async () => {
        const { batchManager } = await import('../batch-manager');
        const initial = batchManager.getConfig().enabledTools.length > 0;
        const toggled = batchManager.toggle();
        expect(toggled).toBe(!initial);
    });

    it('provides stats about queue state', async () => {
        const { batchManager } = await import('../batch-manager');
        const stats = batchManager.getStats();
        expect(stats).toHaveProperty('queueSize');
        expect(stats).toHaveProperty('pendingFlush');
        expect(stats).toHaveProperty('enabled');
    });

    it('notifies parallel results as each tool settles', async () => {
        const { batchManager } = await import('../batch-manager');
        batchManager.updateConfig({ maxParallelTools: 8 });

        const slowController = new AbortController();
        const fastController = new AbortController();
        const settled: string[] = [];
        let releaseSlow!: () => void;
        const slowResult = new Promise<string>((resolve) => {
            releaseSlow = () => resolve('slow');
        });

        const executor = vi.fn((_, __, ___, ____, signal, toolCallId) => {
            if (toolCallId === 'slow-id') {
                expect(signal).toBe(slowController.signal);
                return slowResult;
            }
            expect(toolCallId).toBe('fast-id');
            expect(signal).toBe(fastController.signal);
            return Promise.resolve('fast');
        });

        const promise = batchManager.executeParallel(
            [
                {
                    toolName: 'bash',
                    input: { command: 'sleep 1' },
                    toolCallId: 'slow-id',
                    signal: slowController.signal,
                },
                {
                    toolName: 'bash',
                    input: { command: 'echo fast' },
                    toolCallId: 'fast-id',
                    signal: fastController.signal,
                },
            ],
            executor,
            'BUILD',
            undefined,
            undefined,
            (result) =>
                settled.push(`${result.toolCallId}:${String(result.result)}`),
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(settled).toEqual(['fast-id:fast']);

        releaseSlow();
        const results = await promise;

        expect(results).toHaveLength(2);
        expect(settled).toEqual(['fast-id:fast', 'slow-id:slow']);
        expect(executor).toHaveBeenCalledTimes(2);
    });
});
