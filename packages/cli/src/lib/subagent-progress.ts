/**
 * Module-level tracker for active subagent progress.
 * spawnAgentTool updates this; the status bar and UI can poll it.
 */

export type SubagentStatus = "running" | "completed" | "failed" | "cancelled";

export type SubagentInfo = {
    id: string;
    task: string;
    step: number;
    maxSteps: number;
    currentTool: string | null;
    currentToolInput: string | null;
    startedAt: number;
    toolCallCount: number;
    toolsUsed: Record<string, number>;
    completedAt?: number;
    status: SubagentStatus;
    error?: string;
};

const activeSubagents = new Map<string, SubagentInfo>();

/**
 * Mapping from toolCallId → subagentId so that SpawnAgentCompletionSummary
 * can filter completions to only show the subagent spawned by that tool call.
 */
const toolCallToSubagent = new Map<string, string>();

/**
 * Concurrent-safe context for mapping toolCallId → subagentId.
 *
 * Each parallel tool execution stores its toolCallId keyed by a unique
 * execution ID. spawnAgentTool reads and consumes it (one-shot) so that
 * two parallel spawnAgent calls never collide.
 */
const pendingContexts = new Map<string, string>();

/**
 * Store a toolCallId for a pending tool execution.
 * Returns a unique execution key that the tool must later pass to consumeExecutionContext.
 */
export function setExecutionContext(toolCallId: string): string {
    const execId = crypto.randomUUID();
    pendingContexts.set(execId, toolCallId);
    return execId;
}

/**
 * Read and remove (consume) the toolCallId for a given execution key.
 * Returns undefined if the key was already consumed or doesn't exist.
 * Each key can only be consumed once.
 */
export function consumeExecutionContext(execId: string): string | undefined {
    const toolCallId = pendingContexts.get(execId);
    if (toolCallId !== undefined) {
        pendingContexts.delete(execId);
    }
    return toolCallId;
}

/**
 * @deprecated Use setExecutionContext/consumeExecutionContext instead.
 * Kept only for backwards-compat with sequential tool execution path.
 */
let currentToolCallContext: string | null = null;

export function setCurrentToolCallContext(toolCallId: string | null) {
    currentToolCallContext = toolCallId;
}

export function getCurrentToolCallContext(): string | null {
    return currentToolCallContext;
}

export function getSubagentForToolCall(toolCallId: string): string | undefined {
    return toolCallToSubagent.get(toolCallId);
}

const listeners = new Set<() => void>();
let notifyScheduled = false;

/**
 * Batch notify calls via microtask to avoid render thrashing
 * when multiple incrementToolCall() fire in rapid succession.
 */
function scheduleNotify() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
        notifyScheduled = false;
        for (const fn of listeners) {
            try {
                fn();
            } catch (error) {
                console.error("[subagent-progress] Listener error:", error);
            }
        }
    });
}

export function onSubagentChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function registerSubagent(id: string, task: string, maxSteps: number, toolCallId?: string) {
    activeSubagents.set(id, {
        id,
        task,
        step: 0,
        maxSteps,
        currentTool: null,
        currentToolInput: null,
        startedAt: Date.now(),
        toolCallCount: 0,
        toolsUsed: {},
        status: "running",
    });
    // Map toolCallId → subagentId so we can filter completions per tool call
    if (toolCallId) {
        toolCallToSubagent.set(toolCallId, id);
    } else if (currentToolCallContext) {
        toolCallToSubagent.set(currentToolCallContext, id);
    }
    scheduleNotify();
}

export function updateSubagentStep(id: string, step: number, toolName: string | null) {
    const info = activeSubagents.get(id);
    if (info) {
        info.step = step;
        info.currentTool = toolName;
        if (!toolName) info.currentToolInput = null;
        scheduleNotify();
    }
}

export function completeSubagent(id: string, status: "completed" | "failed" | "cancelled" = "completed", error?: string) {
    const info = activeSubagents.get(id);
    if (info) {
        info.status = status;
        info.completedAt = Date.now();
        if (error) info.error = error;
        scheduleNotify();
    }
}

export function removeSubagent(id: string) {
    activeSubagents.delete(id);
    scheduleNotify();
}

export function incrementToolCall(id: string, toolName?: string, toolInput?: string) {
    const info = activeSubagents.get(id);
    if (info) {
        info.toolCallCount++;
        if (toolName) {
            info.toolsUsed[toolName] = (info.toolsUsed[toolName] || 0) + 1;
            info.currentTool = toolName;
            info.currentToolInput = toolInput ?? null;
        }
        scheduleNotify();
    }
}

export function getActiveSubagents(): SubagentInfo[] {
    return [...activeSubagents.values()];
}

export function getActiveSubagentCount(): number {
    return activeSubagents.size;
}
