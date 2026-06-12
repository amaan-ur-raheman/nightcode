import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    registerSubagent,
    updateSubagentStep,
    removeSubagent,
    getActiveSubagents,
    getActiveSubagentCount,
    onSubagentChange,
} from '../subagent-progress';

function cleanUp() {
    const agents = getActiveSubagents();
    for (const a of agents) {
        removeSubagent(a.id);
    }
}

describe('subagent-progress', () => {
    afterEach(() => {
        cleanUp();
    });

    it('starts with zero active subagents', () => {
        expect(getActiveSubagentCount()).toBe(0);
    });

    it('tracks a registered subagent', () => {
        registerSubagent('agent-1', 'Do something', 10);
        expect(getActiveSubagentCount()).toBe(1);
        const agents = getActiveSubagents();
        expect(agents).toHaveLength(1);
        expect(agents[0]!.id).toBe('agent-1');
        expect(agents[0]!.task).toBe('Do something');
    });

    it('updates step and current tool', () => {
        registerSubagent('agent-2', 'Task', 5);
        updateSubagentStep('agent-2', 3, 'bash');
        const agents = getActiveSubagents();
        const agent = agents.find((a) => a.id === 'agent-2')!;
        expect(agent.step).toBe(3);
        expect(agent.currentTool).toBe('bash');
    });

    it('removes a subagent', () => {
        registerSubagent('agent-3', 'Task', 5);
        expect(getActiveSubagentCount()).toBe(1);
        removeSubagent('agent-3');
        expect(getActiveSubagentCount()).toBe(0);
    });

    it('notifies listeners on changes', async () => {
        const listener = vi.fn();
        const unsubscribe = onSubagentChange(listener);
        registerSubagent('agent-4', 'Task', 5);
        // scheduleNotify uses queueMicrotask — wait for it
        await new Promise((r) => queueMicrotask(r));
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('unsubscribe removes listener', () => {
        const listener = vi.fn();
        const unsubscribe = onSubagentChange(listener);
        unsubscribe();
        registerSubagent('agent-5', 'Task', 5);
        expect(listener).not.toHaveBeenCalled();
    });
});
