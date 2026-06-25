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

    it('batches read_file requests', async () => {
        const { batchManager } = await import('../batch-manager');
        const executor = vi.fn().mockResolvedValue('content');
        // Start two read_file requests — they'll be batched
        const promise1 = batchManager.addRequest(
            'read_file',
            { path: 'a.ts' },
            executor,
            'BUILD',
        );
        const promise2 = batchManager.addRequest(
            'read_file',
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

    it('applies cost-weighted adaptive parallel execution capping', async () => {
        const { batchManager } = await import('../batch-manager');
        const executor = vi.fn().mockResolvedValue('ok');

        // 1. High-cost tools: write_file (weight 6). 10 calls. Avg weight = 6. Cap = 24 / 6 = 4.
        const highCostCalls = Array.from({ length: 10 }, (_, i) => ({
            toolName: 'write_file',
            input: { path: `high-file-${i}.ts`, content: 'ok' },
            toolCallId: `high-${i}`,
        }));

        const highPromise = batchManager.executeParallel(
            highCostCalls,
            executor,
            'BUILD',
        );
        await highPromise;

        // The first batch executed should be capped at 4
        expect(executor).toHaveBeenCalledTimes(4);

        // Reset spy count
        executor.mockClear();

        // 2. Low-cost tools: read_file (weight 1). 10 calls. Avg weight = 1. Cap = 24 / 1 = 24 (bounded by MAX_CAP = 16).
        const lowCostCalls = Array.from({ length: 10 }, (_, i) => ({
            toolName: 'read_file',
            input: { path: `file-${i}.ts` },
            toolCallId: `low-${i}`,
        }));

        const lowPromise = batchManager.executeParallel(
            lowCostCalls,
            executor,
            'BUILD',
        );
        await lowPromise;

        // Low cost calls should execute all 10 in parallel (since 10 <= 16)
        expect(executor).toHaveBeenCalledTimes(10);
    });

    it('only batches read actions for consolidated tools', async () => {
        const { batchManager } = await import('../batch-manager');
        if (batchManager.getConfig().enabledTools.length === 0) {
            batchManager.toggle();
        }
        batchManager.resetStats();

        // 1. Mutating actions should execute immediately
        const executorMutate = vi.fn().mockResolvedValue('mutated');

        // workspace_memory set
        const resSet = await batchManager.addRequest(
            'workspace_memory',
            { action: 'set', key: 'foo', value: 'bar' },
            executorMutate,
            'BUILD',
        );
        expect(resSet).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // workspace_memory delete
        const resDel = await batchManager.addRequest(
            'workspace_memory',
            { action: 'delete', key: 'foo' },
            executorMutate,
            'BUILD',
        );
        expect(resDel).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // manage_keychain set
        const resKeySet = await batchManager.addRequest(
            'manage_keychain',
            { action: 'set', key: 'foo', value: 'bar' },
            executorMutate,
            'BUILD',
        );
        expect(resKeySet).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // knowledge_graph build
        const resKgBuild = await batchManager.addRequest(
            'knowledge_graph',
            { action: 'build' },
            executorMutate,
            'BUILD',
        );
        expect(resKgBuild).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // knowledge_graph add_node
        const resKgAddNode = await batchManager.addRequest(
            'knowledge_graph',
            { action: 'add_node', node: 'foo' },
            executorMutate,
            'BUILD',
        );
        expect(resKgAddNode).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // knowledge_graph add_edge
        const resKgAddEdge = await batchManager.addRequest(
            'knowledge_graph',
            { action: 'add_edge', from: 'foo', to: 'bar' },
            executorMutate,
            'BUILD',
        );
        expect(resKgAddEdge).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // Missing action should execute immediately
        const resMissingAction = await batchManager.addRequest(
            'workspace_memory',
            {},
            executorMutate,
            'BUILD',
        );
        expect(resMissingAction).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // Non-string action should execute immediately
        const resNonStringAction = await batchManager.addRequest(
            'workspace_memory',
            { action: 123 },
            executorMutate,
            'BUILD',
        );
        expect(resNonStringAction).toBe('mutated');
        expect(executorMutate).toHaveBeenCalledTimes(1);
        executorMutate.mockClear();

        // 2. Read-style actions should be batched (not executed immediately)
        const executorRead = vi.fn().mockResolvedValue('read-result');
        const promise1 = batchManager.addRequest(
            'workspace_memory',
            { action: 'get', key: 'foo' },
            executorRead,
            'BUILD',
        );
        const promise2 = batchManager.addRequest(
            'workspace_memory',
            { action: 'list' },
            executorRead,
            'BUILD',
        );

        // At this point, executorRead should not have been called yet
        expect(executorRead).not.toHaveBeenCalled();
        expect(batchManager.getStats().queueSize).toBe(2);

        // After Promise.all resolves (triggered by timeout or batch flush), executorRead should be called
        const [r1, r2] = await Promise.all([promise1, promise2]);
        expect(r1).toBe('read-result');
        expect(r2).toBe('read-result');
        expect(executorRead).toHaveBeenCalledTimes(2);
    });

    it('groups and serializes write operations touching overlapping paths (including move source/dest)', async () => {
        const { batchManager } = await import('../batch-manager');

        const executedOrder: string[] = [];
        const executor = vi.fn(
            async (toolName, input, mode, model, signal, toolCallId) => {
                executedOrder.push(toolCallId as string);
                await new Promise((resolve) => setTimeout(resolve, 10));
                return 'ok';
            },
        );

        const calls = [
            {
                toolName: 'edit_file',
                input: { action: 'move', path: 'a.ts', to: 'b.ts' },
                toolCallId: 'call-move-ab',
            },
            {
                toolName: 'write_file',
                input: { path: 'b.ts', content: 'new' },
                toolCallId: 'call-write-b',
            },
            {
                toolName: 'write_file',
                input: { path: 'c.ts', content: 'hello' },
                toolCallId: 'call-write-c',
            },
        ];

        const results = await batchManager.executeParallel(
            calls,
            executor,
            'BUILD',
        );

        expect(results).toHaveLength(3);
        const idxMove = executedOrder.indexOf('call-move-ab');
        const idxWriteB = executedOrder.indexOf('call-write-b');
        expect(idxMove).toBeGreaterThan(-1);
        expect(idxWriteB).toBeGreaterThan(-1);
        expect(idxMove).toBeLessThan(idxWriteB);
    });

    it('transitively groups conflicting writes sharing paths', async () => {
        const { batchManager } = await import('../batch-manager');

        const executedOrder: string[] = [];
        const executor = vi.fn(
            async (toolName, input, mode, model, signal, toolCallId) => {
                executedOrder.push(toolCallId as string);
                return 'ok';
            },
        );

        const calls = [
            {
                toolName: 'edit_file',
                input: { action: 'move', path: 'a.ts', to: 'b.ts' },
                toolCallId: 'call-1',
            },
            {
                toolName: 'edit_file',
                input: { action: 'move', path: 'b.ts', to: 'c.ts' },
                toolCallId: 'call-2',
            },
            {
                toolName: 'edit_file',
                input: { action: 'move', path: 'c.ts', to: 'd.ts' },
                toolCallId: 'call-3',
            },
        ];

        const results = await batchManager.executeParallel(
            calls,
            executor,
            'BUILD',
        );

        expect(results).toHaveLength(3);
        expect(executedOrder).toEqual(['call-1', 'call-2', 'call-3']);
    });
});
