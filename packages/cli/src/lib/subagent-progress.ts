/**
 * Module-level tracker for active subagent progress.
 * spawnAgentTool updates this; the status bar and UI can poll it.
 */

export type SubagentInfo = {
    id: string;
    task: string;
    step: number;
    maxSteps: number;
    currentTool: string | null;
    startedAt: number;
};

const activeSubagents = new Map<string, SubagentInfo>();

const listeners = new Set<() => void>();

function notify() {
    for (const fn of listeners) fn();
}

export function onSubagentChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function registerSubagent(id: string, task: string, maxSteps: number) {
    activeSubagents.set(id, {
        id,
        task,
        step: 0,
        maxSteps,
        currentTool: null,
        startedAt: Date.now(),
    });
    notify();
}

export function updateSubagentStep(id: string, step: number, toolName: string | null) {
    const info = activeSubagents.get(id);
    if (info) {
        info.step = step;
        info.currentTool = toolName;
        notify();
    }
}

export function removeSubagent(id: string) {
    activeSubagents.delete(id);
    notify();
}

export function getActiveSubagents(): SubagentInfo[] {
    return [...activeSubagents.values()];
}

export function getActiveSubagentCount(): number {
    return activeSubagents.size;
}
