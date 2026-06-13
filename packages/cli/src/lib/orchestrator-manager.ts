import type { TaskGraph } from '@nightcode/shared';
import { serializeGraph, deserializeGraph } from '@nightcode/shared';
import { mkdir, writeFile, readFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const CHECKPOINT_DIR = join(homedir(), '.nightcode', 'checkpoints');
const CHECKPOINT_TTL_MS = 60_000; // Delete checkpoints 60s after completion

export interface OrchestratorState {
    graph: TaskGraph;
    startedAt: number;
    workerCount: number;
    completedWorkers: number;
    abortController?: AbortController;
}

type OrchestratorListener = (states: OrchestratorState[]) => void;

class OrchestratorManager {
    private active = new Map<string, OrchestratorState>();
    private listeners = new Set<OrchestratorListener>();
    private taskAbortControllers = new Map<string, AbortController>();

    /**
     * Mapping from toolCallId → graphId so UI components can filter
     * to only show the graph spawned by a specific orchestrator tool call.
     */
    private toolCallToGraph = new Map<string, string>();

    registerTaskAbortController(
        graphId: string,
        taskId: string,
        controller: AbortController,
    ): void {
        this.taskAbortControllers.set(`${graphId}:${taskId}`, controller);
    }

    unregisterTaskAbortController(graphId: string, taskId: string): void {
        this.taskAbortControllers.delete(`${graphId}:${taskId}`);
    }

    getTaskSignal(graphId: string, taskId: string): AbortSignal | undefined {
        return this.taskAbortControllers.get(`${graphId}:${taskId}`)?.signal;
    }

    abortTask(graphId: string, taskId: string): void {
        const controller = this.taskAbortControllers.get(
            `${graphId}:${taskId}`,
        );
        if (controller) {
            controller.abort();
            this.taskAbortControllers.delete(`${graphId}:${taskId}`);
        }
    }

    private currentToolCallContext: string | null = null;

    setCurrentToolCallContext(toolCallId: string | null) {
        this.currentToolCallContext = toolCallId;
    }

    getGraphForToolCall(toolCallId: string): string | undefined {
        return this.toolCallToGraph.get(toolCallId);
    }

    register(graph: TaskGraph, abortController?: AbortController): void {
        this.active.set(graph.id, {
            graph: { ...graph, nodes: { ...graph.nodes } },
            startedAt: Date.now(),
            workerCount: 0,
            completedWorkers: 0,
            abortController,
        });
        // Map toolCallId → graphId if context is set
        if (this.currentToolCallContext) {
            this.toolCallToGraph.set(this.currentToolCallContext, graph.id);
            this.currentToolCallContext = null;
        }
        this.notify();
    }

    getAbortController(graphId: string): AbortController | undefined {
        return this.active.get(graphId)?.abortController;
    }

    get(graphId: string): OrchestratorState | undefined {
        return this.active.get(graphId);
    }

    getAll(): OrchestratorState[] {
        return Array.from(this.active.values());
    }

    updateGraph(graph: TaskGraph): void {
        const state = this.active.get(graph.id);
        if (state) {
            // Clone the graph so React sees a new reference (graph is mutated in place)
            state.graph = { ...graph, nodes: { ...graph.nodes } };
            this.notify();
            // Persist checkpoint for crash recovery (fire-and-forget)
            saveCheckpoint(graph).catch(() => {});
            // M1: Auto-cleanup terminal graphs after 30s to give UI time to display final status
            if (
                graph.status === 'completed' ||
                graph.status === 'failed' ||
                graph.status === 'cancelled'
            ) {
                setTimeout(() => {
                    this.remove(graph.id);
                }, 30_000);
            }
        }
    }

    incrementWorker(graphId: string): void {
        const state = this.active.get(graphId);
        if (state) {
            state.workerCount++;
            this.notify();
        }
    }

    completeWorker(graphId: string): void {
        const state = this.active.get(graphId);
        if (state) {
            state.completedWorkers++;
            this.notify();
        }
    }

    remove(graphId: string): void {
        this.active.delete(graphId);
        // Delete checkpoint file
        deleteCheckpoint(graphId).catch(() => {});
        // Cleanup workspace asynchronously with error handling
        import('@/lib/workspace')
            .then((m) => m.cleanupWorkspace(graphId))
            .catch(() => {});
        this.notify();
    }

    cleanup(): void {
        const toRemove: string[] = [];
        for (const [id, state] of this.active) {
            if (
                state.graph.status === 'completed' ||
                state.graph.status === 'failed' ||
                state.graph.status === 'cancelled'
            ) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            this.active.delete(id);
            deleteCheckpoint(id).catch(() => {});
            import('@/lib/workspace')
                .then((m) => m.cleanupWorkspace(id))
                .catch(() => {});
        }
        if (toRemove.length > 0) this.notify();
    }

    // Optimized cleanup: remove completed graphs immediately and schedule cleanup
    cleanupCompleted(): void {
        const completedIds: string[] = [];
        for (const [id, state] of this.active) {
            if (
                state.graph.status === 'completed' ||
                state.graph.status === 'failed' ||
                state.graph.status === 'cancelled'
            ) {
                completedIds.push(id);
            }
        }

        // Remove completed graphs immediately
        for (const id of completedIds) {
            this.active.delete(id);
        }

        // Schedule workspace cleanup for removed graphs
        completedIds.forEach((id) => {
            import('@/lib/workspace')
                .then((m) => m.cleanupWorkspace(id))
                .catch(() => {});
        });

        if (completedIds.length > 0) this.notify();
    }

    subscribe(listener: OrchestratorListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const listener of this.listeners) {
            try {
                listener(this.getAll());
            } catch (error) {
                console.error('[orchestrator-manager] Listener error:', error);
            }
        }
    }
}

// ── Checkpoint Persistence ──

/**
 * Save a graph checkpoint to disk.
 * Called on every graph mutation for crash recovery.
 */
export async function saveCheckpoint(graph: TaskGraph): Promise<void> {
    try {
        await mkdir(CHECKPOINT_DIR, { recursive: true });
        const filePath = join(CHECKPOINT_DIR, `${graph.id}.json`);
        const json = serializeGraph(graph);
        await writeFile(filePath, json, 'utf-8');
    } catch (err) {
        console.error(`[checkpoint] Failed to save graph ${graph.id}:`, err);
    }
}

/**
 * Load a graph checkpoint from disk.
 * Returns null if no checkpoint exists or it's invalid.
 */
export async function loadCheckpoint(
    graphId: string,
): Promise<TaskGraph | null> {
    try {
        const filePath = join(CHECKPOINT_DIR, `${graphId}.json`);
        const json = await readFile(filePath, 'utf-8');
        return deserializeGraph(json);
    } catch {
        return null;
    }
}

/**
 * Delete a checkpoint file from disk.
 */
export async function deleteCheckpoint(graphId: string): Promise<void> {
    try {
        const filePath = join(CHECKPOINT_DIR, `${graphId}.json`);
        await unlink(filePath);
    } catch {
        // Ignore — file may not exist
    }
}

/**
 * List all checkpoint graph IDs on disk.
 */
export async function listCheckpoints(): Promise<string[]> {
    try {
        const files = await readdir(CHECKPOINT_DIR);
        return files
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace('.json', ''));
    } catch {
        return [];
    }
}

/**
 * Schedule checkpoint cleanup after a graph reaches a terminal state.
 */
export function scheduleCheckpointCleanup(graphId: string): void {
    setTimeout(
        () => deleteCheckpoint(graphId).catch(() => {}),
        CHECKPOINT_TTL_MS,
    );
}

export const orchestratorManager = new OrchestratorManager();
