import { toolInputSchemas, type ModeType } from '@nightcode/shared';

export type TaskItem = {
    id: string;
    description: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    createdAt: number;
    completedAt?: number;
};

export type TaskListState = {
    tasks: TaskItem[];
    updatedAt: number;
};

// Module-level state for the current task list (session-scoped)
let currentTaskList: TaskListState | null = null;

// Event listeners for UI updates
const listeners = new Set<() => void>();
let notifyScheduled = false;

function scheduleNotify() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
        notifyScheduled = false;
        for (const fn of listeners) {
            try {
                fn();
            } catch {
                /* ignore */
            }
        }
    });
}

export function onTaskListChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

export function getTaskList(): TaskListState | null {
    return currentTaskList;
}

function formatTaskList(state: TaskListState): string {
    const { tasks } = state;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const total = tasks.length;

    const lines: string[] = [];

    if (total === 0) {
        return 'Task list is empty.';
    }

    for (const task of tasks) {
        const symbol =
            task.status === 'completed'
                ? '✓'
                : task.status === 'in-progress'
                  ? '◉'
                  : task.status === 'failed'
                    ? '✗'
                    : '○';
        const statusLabel =
            task.status === 'completed'
                ? 'done'
                : task.status === 'in-progress'
                  ? 'current'
                  : task.status === 'failed'
                    ? 'failed'
                    : '';
        lines.push(
            `  ${symbol} ${task.id}. ${task.description}${statusLabel ? ` (${statusLabel})` : ''}`,
        );
    }

    return `Task List (${completed}/${total} completed)\n${lines.join('\n')}`;
}

export async function taskListTool(
    input: unknown,
    _parentMode?: ModeType,
    _parentModel?: string,
    _signal?: AbortSignal,
    _execId?: string,
): Promise<unknown> {
    const { action, tasks, taskId, status } =
        toolInputSchemas.taskList.parse(input);

    switch (action) {
        case 'create': {
            if (!tasks || tasks.length === 0) {
                throw new Error("tasks array is required for 'create' action");
            }
            // Validate unique IDs
            const ids = new Set<string>();
            for (const t of tasks) {
                if (ids.has(t.id)) {
                    throw new Error(`Duplicate task ID: "${t.id}"`);
                }
                ids.add(t.id);
            }
            currentTaskList = {
                tasks: tasks.map((t) => ({
                    id: t.id,
                    description: t.description,
                    status: 'pending' as const,
                    createdAt: Date.now(),
                })),
                updatedAt: Date.now(),
            };
            scheduleNotify();
            return formatTaskList(currentTaskList);
        }

        case 'update': {
            if (!currentTaskList) {
                throw new Error(
                    "No active task list. Call taskList with action='create' first.",
                );
            }
            if (!taskId) {
                throw new Error("taskId is required for 'update' action");
            }
            if (!status) {
                throw new Error("status is required for 'update' action");
            }
            const task = currentTaskList.tasks.find((t) => t.id === taskId);
            if (!task) {
                throw new Error(`Task "${taskId}" not found`);
            }
            task.status = status;
            if (status === 'completed') {
                task.completedAt = Date.now();
            }
            currentTaskList.updatedAt = Date.now();
            scheduleNotify();
            return formatTaskList(currentTaskList);
        }

        case 'complete': {
            if (!currentTaskList) {
                throw new Error(
                    "No active task list. Call taskList with action='create' first.",
                );
            }
            if (!taskId) {
                throw new Error("taskId is required for 'complete' action");
            }
            const task = currentTaskList.tasks.find((t) => t.id === taskId);
            if (!task) {
                throw new Error(`Task "${taskId}" not found`);
            }
            task.status = 'completed';
            task.completedAt = Date.now();
            currentTaskList.updatedAt = Date.now();
            scheduleNotify();
            return formatTaskList(currentTaskList);
        }

        case 'remove': {
            if (!currentTaskList) {
                throw new Error(
                    "No active task list. Call taskList with action='create' first.",
                );
            }
            if (!taskId) {
                throw new Error("taskId is required for 'remove' action");
            }
            const idx = currentTaskList.tasks.findIndex((t) => t.id === taskId);
            if (idx === -1) {
                throw new Error(`Task "${taskId}" not found`);
            }
            currentTaskList.tasks.splice(idx, 1);
            currentTaskList.updatedAt = Date.now();
            scheduleNotify();
            return formatTaskList(currentTaskList);
        }

        case 'list': {
            if (!currentTaskList || currentTaskList.tasks.length === 0) {
                return 'No active task list.';
            }
            return formatTaskList(currentTaskList);
        }

        default: {
            throw new Error(`Unknown action: ${action}`);
        }
    }
}
