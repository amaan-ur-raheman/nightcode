import type { TaskGraph } from "@nightcode/shared";

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

    /**
     * Mapping from toolCallId → graphId so UI components can filter
     * to only show the graph spawned by a specific orchestrator tool call.
     */
    private toolCallToGraph = new Map<string, string>();

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
            // M1: Auto-cleanup terminal graphs after 30s to give UI time to display final status
            if (graph.status === "completed" || graph.status === "failed" || graph.status === "cancelled") {
                setTimeout(() => this.remove(graph.id), 30_000);
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
        // Cleanup workspace asynchronously with error handling
        import("@/lib/workspace").then(m => m.cleanupWorkspace(graphId)).catch(() => {});
        this.notify();
    }

    cleanup(): void {
        const toRemove: string[] = [];
        for (const [id, state] of this.active) {
            if (state.graph.status === "completed" || state.graph.status === "failed" || state.graph.status === "cancelled") {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            this.active.delete(id);
            import("@/lib/workspace").then(m => m.cleanupWorkspace(id)).catch(() => {});
        }
        if (toRemove.length > 0) this.notify();
    }

    // Optimized cleanup: remove completed graphs immediately and schedule cleanup
    cleanupCompleted(): void {
        const completedIds: string[] = [];
        for (const [id, state] of this.active) {
            if (state.graph.status === "completed" || state.graph.status === "failed" || state.graph.status === "cancelled") {
                completedIds.push(id);
            }
        }
        
        // Remove completed graphs immediately
        for (const id of completedIds) {
            this.active.delete(id);
        }
        
        // Schedule workspace cleanup for removed graphs
        completedIds.forEach(id => {
            import("@/lib/workspace").then(m => m.cleanupWorkspace(id)).catch(() => {});
        });
        
        if (completedIds.length > 0) this.notify();
    }

    subscribe(listener: OrchestratorListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify(): void {
        for (const listener of this.listeners) {
            try {
                listener(this.getAll());
            } catch (error) {
                console.error("[orchestrator-manager] Listener error:", error);
            }
        }
    }
}

export const orchestratorManager = new OrchestratorManager();
