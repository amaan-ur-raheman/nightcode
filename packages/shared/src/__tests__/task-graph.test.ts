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
    type TaskNode,
} from '../task-graph';

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
    return {
        type: 'coder',
        description: `Task ${overrides.id}`,
        dependencies: [],
        status: 'pending',
        files: [],
        mode: 'BUILD',
        createdAt: Date.now(),
        retryCount: 0,
        maxRetries: 2,
        ...overrides,
    };
}

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
