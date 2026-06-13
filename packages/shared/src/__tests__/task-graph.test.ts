import { describe, it, expect } from 'vitest';
import {
    createTaskGraph,
    getReadyTasks,
    markTaskRunning,
    markTaskCompleted,
    markTaskFailed,
    cancelTask,
    getTopologicalOrder,
    getCriticalPath,
    getGraphStats,
    validateGraph,
    serializeGraph,
    deserializeGraph,
    getCompletedTaskIds,
    getCompletedResults,
    type TaskNode,
} from '../task-graph';

// Helper to assert a node exists (type-safe lookup)
function node(graph: ReturnType<typeof createTaskGraph>, id: string): TaskNode {
    const n = graph.nodes[id];
    if (!n) throw new Error(`Node "${id}" not found in graph`);
    return n;
}

describe('createTaskGraph', () => {
    it('creates a graph with pending nodes', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'tester',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        expect(graph.name).toBe('test');
        expect(graph.status).toBe('running');
        expect(graph.version).toBe(0);
        expect(Object.keys(graph.nodes)).toHaveLength(2);
        expect(node(graph, 'a').status).toBe('pending');
        expect(node(graph, 'b').status).toBe('pending');
        expect(graph.edges['b']).toEqual(['a']);
    });

    it('builds edges from dependencies when not provided', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        expect(graph.edges['a']).toEqual([]);
        expect(graph.edges['b']).toEqual(['a']);
    });

    it('uses provided edges when given', () => {
        const graph = createTaskGraph(
            'test',
            [
                {
                    id: 'a',
                    type: 'coder',
                    description: 'A',
                    dependencies: [],
                    files: [],
                    mode: 'BUILD',
                },
                {
                    id: 'b',
                    type: 'coder',
                    description: 'B',
                    dependencies: [],
                    files: [],
                    mode: 'BUILD',
                },
            ],
            { a: [], b: ['a'] },
        );

        expect(graph.edges['b']).toEqual(['a']);
    });

    it('sets default maxRetries to 2', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        expect(node(graph, 'a').maxRetries).toBe(2);
        expect(node(graph, 'a').retryCount).toBe(0);
    });

    it('respects custom maxRetries', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
                maxRetries: 5,
            },
        ]);

        expect(node(graph, 'a').maxRetries).toBe(5);
    });

    it('generates a unique id', () => {
        const g1 = createTaskGraph('test', []);
        const g2 = createTaskGraph('test', []);
        expect(g1.id).not.toBe(g2.id);
    });
});

describe('getReadyTasks', () => {
    it('returns tasks with no dependencies', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        const ready = getReadyTasks(graph);
        expect(ready).toHaveLength(1);
        expect(ready[0]!.id).toBe('a');
    });

    it('returns tasks whose dependencies are completed', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskCompleted(graph, 'a', 'done');
        const ready = getReadyTasks(graph);
        expect(ready).toHaveLength(1);
        expect(ready[0]!.id).toBe('b');
    });

    it('does not return running tasks', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskRunning(graph, 'a');
        const ready = getReadyTasks(graph);
        expect(ready).toHaveLength(0);
    });

    it('does not return tasks with failed dependencies', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        // Max retries = 2, so fail 3 times to actually fail
        markTaskFailed(graph, 'a', 'err');
        markTaskFailed(graph, 'a', 'err');
        markTaskFailed(graph, 'a', 'err');
        const ready = getReadyTasks(graph);
        expect(ready).toHaveLength(0);
    });

    it('returns multiple independent tasks', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'c',
                type: 'coder',
                description: 'C',
                dependencies: ['a', 'b'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        const ready = getReadyTasks(graph);
        expect(ready).toHaveLength(2);
    });
});

describe('markTaskRunning', () => {
    it('sets status to running and records agent', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskRunning(graph, 'a', 'agent-1');
        expect(node(graph, 'a').status).toBe('running');
        expect(node(graph, 'a').assignedAgent).toBe('agent-1');
        expect(node(graph, 'a').startedAt).toBeDefined();
        expect(graph.version).toBe(1);
    });

    it('increments version', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        expect(graph.version).toBe(0);
        markTaskRunning(graph, 'a');
        expect(graph.version).toBe(1);
    });
});

describe('markTaskCompleted', () => {
    it('sets status to completed with result', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskCompleted(graph, 'a', 'all done');
        expect(node(graph, 'a').status).toBe('completed');
        expect(node(graph, 'a').result).toBe('all done');
        expect(node(graph, 'a').completedAt).toBeDefined();
    });

    it('marks graph as completed when all tasks done', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskCompleted(graph, 'a', 'done');
        expect(graph.status).toBe('running');
        markTaskCompleted(graph, 'b', 'done');
        expect(graph.status).toBe('completed');
        expect(graph.completedAt).toBeDefined();
    });
});

describe('markTaskFailed', () => {
    it('retries on first failure (status stays pending)', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
                maxRetries: 2,
            },
        ]);

        markTaskFailed(graph, 'a', 'error 1');
        expect(node(graph, 'a').status).toBe('pending');
        expect(node(graph, 'a').retryCount).toBe(1);
        expect(node(graph, 'a').retryAfter).toBeDefined();
    });

    it('marks as failed after max retries exceeded', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
                maxRetries: 1,
            },
        ]);

        markTaskFailed(graph, 'a', 'error 1');
        expect(node(graph, 'a').status).toBe('pending');
        markTaskFailed(graph, 'a', 'error 2');
        expect(node(graph, 'a').status).toBe('failed');
        expect(node(graph, 'a').error).toBe('error 2');
    });

    it('cancels downstream tasks on permanent failure', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
                maxRetries: 0,
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskFailed(graph, 'a', 'fatal');
        expect(node(graph, 'b').status).toBe('cancelled');
    });

    it('marks graph as failed when all tasks fail/cancel', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
                maxRetries: 0,
            },
        ]);

        markTaskFailed(graph, 'a', 'fatal');
        expect(graph.status).toBe('failed');
    });

    it('marks graph as completed if at least one task succeeded', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
                maxRetries: 0,
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: [],
                files: [],
                mode: 'BUILD',
                maxRetries: 0,
            },
        ]);

        markTaskCompleted(graph, 'a', 'ok');
        markTaskFailed(graph, 'b', 'fatal');
        expect(graph.status).toBe('completed');
    });
});

describe('cancelTask', () => {
    it('cancels a pending task', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        cancelTask(graph, 'a');
        expect(node(graph, 'a').status).toBe('cancelled');
    });

    it('cancels a running task', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskRunning(graph, 'a');
        cancelTask(graph, 'a');
        expect(node(graph, 'a').status).toBe('cancelled');
    });

    it('does not cancel a completed task', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskCompleted(graph, 'a', 'done');
        cancelTask(graph, 'a');
        expect(node(graph, 'a').status).toBe('completed');
    });

    it('cancels downstream dependencies', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'c',
                type: 'coder',
                description: 'C',
                dependencies: ['b'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        cancelTask(graph, 'a');
        expect(node(graph, 'b').status).toBe('cancelled');
        expect(node(graph, 'c').status).toBe('cancelled');
    });
});

describe('getTopologicalOrder', () => {
    it('returns correct topological order', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'c',
                type: 'coder',
                description: 'C',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'd',
                type: 'coder',
                description: 'D',
                dependencies: ['b', 'c'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        const order = getTopologicalOrder(graph);
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
        expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
        expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    });

    it('handles independent tasks', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        const order = getTopologicalOrder(graph);
        expect(order).toHaveLength(2);
    });
});

describe('getCriticalPath', () => {
    it('returns empty path for empty graph', () => {
        const graph = createTaskGraph('test', []);
        expect(getCriticalPath(graph)).toEqual([]);
    });

    it('returns single node path for single task', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskRunning(graph, 'a');
        // Set startedAt manually so getCriticalPath can compute duration > 0
        node(graph, 'a').startedAt = Date.now() - 1000;
        markTaskCompleted(graph, 'a', 'done');
        const path = getCriticalPath(graph);
        expect(path).toContain('a');
    });
});

describe('getGraphStats', () => {
    it('counts all statuses', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'c',
                type: 'coder',
                description: 'C',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskCompleted(graph, 'a', 'done');
        markTaskRunning(graph, 'b');

        const stats = getGraphStats(graph);
        expect(stats.total).toBe(3);
        expect(stats.completed).toBe(1);
        expect(stats.running).toBe(1);
        expect(stats.pending).toBe(1);
        expect(stats.failed).toBe(0);
        expect(stats.cancelled).toBe(0);
        expect(stats.progress).toBe(33);
    });

    it('returns 100% when all completed', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);

        markTaskCompleted(graph, 'a', 'done');
        expect(getGraphStats(graph).progress).toBe(100);
    });

    it('returns 0% for empty graph', () => {
        const graph = createTaskGraph('test', []);
        expect(getGraphStats(graph).progress).toBe(0);
    });
});

describe('validateGraph', () => {
    it('returns no errors for valid graph', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        expect(validateGraph(graph)).toEqual([]);
    });

    it('detects missing dependency', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: ['nonexistent'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        const errors = validateGraph(graph);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('nonexistent');
    });

    it('detects cycles', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: ['b'],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);

        const errors = validateGraph(graph);
        expect(errors.some((e) => e.includes('Cycle'))).toBe(true);
    });
});

describe('serializeGraph / deserializeGraph', () => {
    it('round-trips a graph through serialization', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'tester',
                description: 'B',
                dependencies: ['a'],
                files: [],
                mode: 'BUILD',
            },
        ]);
        markTaskCompleted(graph, 'a', 'result A');
        markTaskRunning(graph, 'b');

        const json = serializeGraph(graph);
        const restored = deserializeGraph(json);

        expect(restored).not.toBeNull();
        expect(restored!.id).toBe(graph.id);
        expect(restored!.name).toBe('test');
        expect(restored!.status).toBe('running');
        expect(restored!.version).toBe(graph.version);
        expect(restored!.nodes['a']!.status).toBe('completed');
        expect(restored!.nodes['a']!.result).toBe('result A');
        expect(restored!.nodes['b']!.status).toBe('running');
    });

    it('returns null for invalid JSON', () => {
        expect(deserializeGraph('not json')).toBeNull();
    });

    it('returns null for missing _version', () => {
        expect(deserializeGraph(JSON.stringify({ graph: {} }))).toBeNull();
    });

    it('returns null for future version', () => {
        const payload = { _version: 999, graph: {}, serializedAt: Date.now() };
        expect(deserializeGraph(JSON.stringify(payload))).toBeNull();
    });

    it('returns null for missing required graph fields', () => {
        const payload = {
            _version: 1,
            graph: { id: 'x' },
            serializedAt: Date.now(),
        };
        expect(deserializeGraph(JSON.stringify(payload))).toBeNull();
    });

    it('returns null for invalid node structure', () => {
        const payload = {
            _version: 1,
            serializedAt: Date.now(),
            graph: {
                id: 'g1',
                name: 'test',
                nodes: {
                    a: {
                        id: 'a',
                        description: 'A',
                        dependencies: ['nonexistent'],
                    },
                },
                edges: {},
                status: 'running',
                createdAt: Date.now(),
                version: 0,
            },
        };
        expect(deserializeGraph(JSON.stringify(payload))).toBeNull();
    });

    it('returns null if node type, status, or mode is invalid', () => {
        const createPayload = (nodeOverrides: any) => ({
            _version: 1,
            serializedAt: Date.now(),
            graph: {
                id: 'g1',
                name: 'test',
                nodes: {
                    a: {
                        id: 'a',
                        description: 'A',
                        dependencies: [],
                        retryCount: 0,
                        maxRetries: 3,
                        files: [],
                        type: 'coder',
                        status: 'pending',
                        mode: 'BUILD',
                        ...nodeOverrides,
                    },
                },
                edges: {},
                status: 'running',
                createdAt: Date.now(),
                version: 0,
            },
        });

        // Invalid type
        expect(
            deserializeGraph(
                JSON.stringify(createPayload({ type: 'invalid_role' })),
            ),
        ).toBeNull();
        // Invalid status
        expect(
            deserializeGraph(
                JSON.stringify(createPayload({ status: 'invalid_status' })),
            ),
        ).toBeNull();
        // Invalid mode
        expect(
            deserializeGraph(
                JSON.stringify(createPayload({ mode: 'invalid_mode' })),
            ),
        ).toBeNull();
    });

    it('preserves all node fields through round-trip', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: ['src/a.ts'],
                mode: 'BUILD',
                model: 'gpt-4o',
            },
        ]);
        markTaskCompleted(graph, 'a', 'done');

        const json = serializeGraph(graph);
        const restored = deserializeGraph(json)!;

        const nodeA = restored.nodes['a']!;
        expect(nodeA.type).toBe('coder');
        expect(nodeA.files).toEqual(['src/a.ts']);
        expect(nodeA.model).toBe('gpt-4o');
        expect(nodeA.result).toBe('done');
        expect(nodeA.completedAt).toBeDefined();
    });
});

describe('getCompletedTaskIds', () => {
    it('returns IDs of completed tasks', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);
        markTaskCompleted(graph, 'a', 'done');

        const completed = getCompletedTaskIds(graph);
        expect(completed.has('a')).toBe(true);
        expect(completed.has('b')).toBe(false);
    });
});

describe('getCompletedResults', () => {
    it('returns task ID → result map for completed tasks', () => {
        const graph = createTaskGraph('test', [
            {
                id: 'a',
                type: 'coder',
                description: 'A',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
            {
                id: 'b',
                type: 'coder',
                description: 'B',
                dependencies: [],
                files: [],
                mode: 'BUILD',
            },
        ]);
        markTaskCompleted(graph, 'a', 'result A');
        markTaskFailed(graph, 'b', 'error');

        const results = getCompletedResults(graph);
        expect(results['a']).toBe('result A');
        expect(results['b']).toBeUndefined();
    });
});
