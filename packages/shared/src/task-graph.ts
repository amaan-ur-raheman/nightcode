export type TaskStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
export type AgentRole =
    | 'orchestrator'
    | 'coder'
    | 'reviewer'
    | 'tester'
    | 'researcher'
    | 'debugger';

export interface TaskNode {
    id: string;
    type: AgentRole;
    description: string;
    dependencies: string[];
    status: TaskStatus;
    assignedAgent?: string;
    result?: string;
    error?: string;
    files: string[];
    mode: 'BUILD' | 'PLAN';
    model?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    retryCount: number;
    maxRetries: number;
    toolsUsed?: Record<string, number>;
    currentTool?: string | null;
    currentToolInput?: string | null;
    /** Timestamp after which this task is eligible to retry (exponential backoff). */
    retryAfter?: number;
    /** Whether the task completed with partial results (downstream should adapt). */
    degraded?: boolean;
    /** Max wall-clock ms for this worker (default 300_000 = 5 min). */
    maxDurationMs?: number;
}

export interface TaskGraph {
    id: string;
    name: string;
    nodes: Record<string, TaskNode>;
    edges: Record<string, string[]>;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    createdAt: number;
    completedAt?: number;
    /** Monotonically increasing counter — incremented on every mutation so React can detect changes. */
    version: number;
}

export function createTaskGraph(
    name: string,
    tasks: Array<
        Omit<TaskNode, 'status' | 'createdAt' | 'retryCount' | 'maxRetries'> & {
            maxRetries?: number;
        }
    >,
    edges?: Record<string, string[]>,
): TaskGraph {
    const nodes: Record<string, TaskNode> = {};
    for (const task of tasks) {
        nodes[task.id] = {
            ...task,
            status: 'pending',
            createdAt: Date.now(),
            retryCount: 0,
            maxRetries: task.maxRetries ?? 2,
        };
    }

    return {
        id: crypto.randomUUID(),
        name,
        nodes,
        edges: edges ?? buildEdgesFromDependencies(nodes),
        status: 'running',
        createdAt: Date.now(),
        version: 0,
    };
}

function buildEdgesFromDependencies(
    nodes: Record<string, TaskNode>,
): Record<string, string[]> {
    const edges: Record<string, string[]> = {};
    for (const [id, node] of Object.entries(nodes)) {
        edges[id] = node.dependencies;
    }
    return edges;
}

export function getReadyTasks(graph: TaskGraph): TaskNode[] {
    const now = Date.now();
    return Object.values(graph.nodes).filter((node) => {
        if (node.status !== 'pending') return false;
        // Respect exponential backoff: skip tasks still in cooldown
        if (node.retryAfter && node.retryAfter > now) return false;
        return node.dependencies.every((depId) => {
            const dep = graph.nodes[depId];
            return dep?.status === 'completed';
        });
    });
}

export function markTaskRunning(
    graph: TaskGraph,
    taskId: string,
    agentId?: string,
): void {
    const node = graph.nodes[taskId];
    if (node) {
        node.status = 'running';
        node.startedAt = Date.now();
        node.assignedAgent = agentId;
        graph.version++;
    }
}

export function markTaskCompleted(
    graph: TaskGraph,
    taskId: string,
    result: string,
): void {
    const node = graph.nodes[taskId];
    if (node) {
        node.status = 'completed';
        node.result = result;
        node.completedAt = Date.now();
        graph.version++;
    }
    checkGraphCompletion(graph);
}

export function markTaskFailed(
    graph: TaskGraph,
    taskId: string,
    error: string,
): void {
    const node = graph.nodes[taskId];
    if (node) {
        if (node.retryCount < node.maxRetries) {
            node.retryCount++;
            node.status = 'pending';
            node.error = error;
            node.assignedAgent = undefined;
            node.startedAt = undefined;
            // Exponential backoff: 2s, 4s, 8s, ...
            node.retryAfter = Date.now() + 1000 * Math.pow(2, node.retryCount);
        } else {
            node.status = 'failed';
            node.error = error;
            node.completedAt = Date.now();
            cancelDownstream(graph, taskId);
            checkGraphCompletion(graph);
        }
        graph.version++;
    }
}

export function cancelTask(graph: TaskGraph, taskId: string): void {
    const node = graph.nodes[taskId];
    if (node && (node.status === 'pending' || node.status === 'running')) {
        node.status = 'cancelled';
        node.completedAt = Date.now();
        cancelDownstream(graph, taskId);
        checkGraphCompletion(graph);
        graph.version++;
    }
}

function cancelDownstream(graph: TaskGraph, failedTaskId: string): void {
    for (const [id, node] of Object.entries(graph.nodes)) {
        if (
            node.status !== 'completed' &&
            node.status !== 'failed' &&
            node.status !== 'cancelled' &&
            node.dependencies.includes(failedTaskId)
        ) {
            node.status = 'cancelled';
            node.completedAt = Date.now();
            cancelDownstream(graph, id);
        }
    }
}

export function checkGraphCompletion(graph: TaskGraph): void {
    // L1: Skip if already in a terminal state (prevents redundant calls during batch cancel)
    if (graph.status !== 'running') return;

    const statuses = Object.values(graph.nodes).map((n) => n.status);
    if (statuses.every((s) => s === 'completed')) {
        graph.status = 'completed';
        graph.completedAt = Date.now();
        graph.version++;
    } else if (
        statuses.every(
            (s) => s === 'completed' || s === 'failed' || s === 'cancelled',
        )
    ) {
        // Graph is done — mark "completed" if at least one task succeeded,
        // otherwise "failed"
        const hasCompleted = statuses.some((s) => s === 'completed');
        graph.status = hasCompleted ? 'completed' : 'failed';
        graph.completedAt = Date.now();
        graph.version++;
    }
}

export function getTopologicalOrder(graph: TaskGraph): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const visiting = new Set<string>();

    function visit(id: string) {
        if (visited.has(id) || visiting.has(id)) return;
        visiting.add(id);
        for (const depId of graph.nodes[id]?.dependencies ?? []) {
            visit(depId);
        }
        visiting.delete(id);
        visited.add(id);
        order.push(id);
    }

    for (const id of Object.keys(graph.nodes)) {
        visit(id);
    }
    return order;
}

export function getCriticalPath(graph: TaskGraph): string[] {
    const order = getTopologicalOrder(graph);
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();

    for (const id of order) {
        const node = graph.nodes[id];
        if (!node) continue;
        const duration =
            node.completedAt && node.startedAt
                ? node.completedAt - node.startedAt
                : 0;

        let maxDist = 0;
        let bestPrev: string | null = null;
        for (const depId of node.dependencies) {
            const d = dist.get(depId) ?? 0;
            if (d > maxDist) {
                maxDist = d;
                bestPrev = depId;
            }
        }
        dist.set(id, maxDist + duration);
        prev.set(id, bestPrev);
    }

    // Find the end node with max distance
    let maxDist = 0;
    let endId: string | null = null;
    for (const [id, d] of dist) {
        const node = graph.nodes[id];
        if (
            node &&
            (node.status === 'completed' || node.status === 'running') &&
            d > maxDist
        ) {
            maxDist = d;
            endId = id;
        }
    }

    const path: string[] = [];
    let current = endId;
    while (current) {
        path.unshift(current);
        current = prev.get(current) ?? null;
    }
    return path;
}

export function getGraphStats(graph: TaskGraph) {
    const nodes = Object.values(graph.nodes);
    return {
        total: nodes.length,
        completed: nodes.filter((n) => n.status === 'completed').length,
        running: nodes.filter((n) => n.status === 'running').length,
        pending: nodes.filter((n) => n.status === 'pending').length,
        failed: nodes.filter((n) => n.status === 'failed').length,
        cancelled: nodes.filter((n) => n.status === 'cancelled').length,
        progress:
            nodes.length > 0
                ? Math.round(
                      (nodes.filter((n) => n.status === 'completed').length /
                          nodes.length) *
                          100,
                  )
                : 0,
        duration: graph.completedAt
            ? graph.completedAt - graph.createdAt
            : Date.now() - graph.createdAt,
    };
}

export function validateGraph(graph: TaskGraph): string[] {
    const errors: string[] = [];
    const ids = new Set(Object.keys(graph.nodes));

    for (const [id, node] of Object.entries(graph.nodes)) {
        for (const depId of node.dependencies) {
            if (!ids.has(depId)) {
                errors.push(
                    `Task "${id}" depends on non-existent task "${depId}"`,
                );
            }
        }
    }

    // Check for cycles
    const visited = new Set<string>();
    const visiting = new Set<string>();
    function hasCycle(id: string): boolean {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        for (const depId of graph.nodes[id]?.dependencies ?? []) {
            if (hasCycle(depId)) return true;
        }
        visiting.delete(id);
        visited.add(id);
        return false;
    }

    for (const id of Object.keys(graph.nodes)) {
        if (hasCycle(id)) {
            errors.push(`Cycle detected involving task "${id}"`);
            break;
        }
    }

    return errors;
}

// ── Checkpoint Serialization ──

const CHECKPOINT_VERSION = 1;

interface SerializedGraph {
    _version: number;
    graph: TaskGraph;
    serializedAt: number;
}

/**
 * Serialize a TaskGraph to a JSON string for checkpoint persistence.
 * Includes version field for forward compatibility.
 */
export function serializeGraph(graph: TaskGraph): string {
    const payload: SerializedGraph = {
        _version: CHECKPOINT_VERSION,
        graph,
        serializedAt: Date.now(),
    };
    return JSON.stringify(payload);
}

/**
 * Deserialize a TaskGraph from a checkpoint JSON string.
 * Returns null if the data is invalid or version is unsupported.
 */
export function deserializeGraph(json: string): TaskGraph | null {
    try {
        const parsed = JSON.parse(json) as Partial<SerializedGraph>;

        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed._version !== 'number') return null;
        if (parsed._version > CHECKPOINT_VERSION) return null; // future version, can't read
        if (!parsed.graph || typeof parsed.graph !== 'object') return null;

        const g = parsed.graph as Record<string, any>;

        // Validate required fields
        if (typeof g.id !== 'string') return null;
        if (typeof g.name !== 'string') return null;
        if (!g.nodes || typeof g.nodes !== 'object') return null;
        if (!g.edges || typeof g.edges !== 'object') return null;
        if (!['running', 'completed', 'failed', 'cancelled'].includes(g.status))
            return null;
        if (typeof g.createdAt !== 'number') return null;
        if (typeof g.version !== 'number') return null;

        // Validate node structure
        for (const [id, node] of Object.entries(
            g.nodes as Record<string, any>,
        )) {
            if (typeof node !== 'object' || node === null) return null;
            if (typeof node.id !== 'string' || node.id !== id) return null;
            if (typeof node.description !== 'string') return null;
            if (!Array.isArray(node.dependencies)) return null;
            if (typeof node.retryCount !== 'number') return null;
            if (typeof node.maxRetries !== 'number') return null;
            if (typeof node.files !== 'object' || !Array.isArray(node.files))
                return null;
            if (
                typeof node.type !== 'string' ||
                ![
                    'orchestrator',
                    'coder',
                    'reviewer',
                    'tester',
                    'researcher',
                    'debugger',
                ].includes(node.type)
            )
                return null;
            if (
                typeof node.status !== 'string' ||
                ![
                    'pending',
                    'running',
                    'completed',
                    'failed',
                    'cancelled',
                    'paused',
                ].includes(node.status)
            )
                return null;
            if (node.mode !== 'BUILD' && node.mode !== 'PLAN') return null;
        }

        return parsed.graph as TaskGraph;
    } catch {
        return null;
    }
}

/**
 * Get completed task IDs from a graph (useful for resume).
 */
export function getCompletedTaskIds(graph: TaskGraph): Set<string> {
    const completed = new Set<string>();
    for (const [id, node] of Object.entries(graph.nodes)) {
        if (node.status === 'completed') {
            completed.add(id);
        }
    }
    return completed;
}

/**
 * Get the aggregated results of completed tasks (for dependency injection on resume).
 */
export function getCompletedResults(graph: TaskGraph): Record<string, string> {
    const results: Record<string, string> = {};
    for (const [id, node] of Object.entries(graph.nodes)) {
        if (node.status === 'completed' && node.result) {
            results[id] = node.result;
        }
    }
    return results;
}
