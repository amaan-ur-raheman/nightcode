import type { TaskNode, TaskGraph, AgentRole } from '@nightcode/shared';
import {
    markTaskRunning,
    markTaskCompleted,
    markTaskFailed,
    getReadyTasks,
    getTopologicalOrder,
    getCriticalPath,
} from '@nightcode/shared';
import { getValidAuth } from '@/lib/auth';
import { runSubagentLoop } from '@/lib/subagent-loop';
import {
    registerSubagent,
    removeSubagent,
    getActiveSubagents,
    onSubagentChange,
} from '@/lib/subagent-progress';
import { debug } from './debug';
import { orchestratorManager } from './orchestrator-manager';
import { resolveProviderFallback, extractProvider } from '@/lib/model-utils';
import {
    acquireSlot,
    releaseSlot,
    setProviderConcurrency,
    recordProviderLatency,
} from '@/lib/concurrency-limit';
import { messageBroker } from '@/lib/message-broker';
import { writeResult } from '@/lib/workspace';

const WORKER_SYSTEM_PROMPTS: Record<AgentRole, string> = {
    orchestrator:
        'You are an orchestrator agent managing a team of specialized workers.',
    coder: 'You are an expert software engineer. Implement the assigned coding task precisely. Write clean, production-quality code. Verify your work by reading the files you modified.',
    reviewer:
        'You are a senior code reviewer. Analyze the code for bugs, security issues, performance problems, and adherence to best practices. Provide specific, actionable feedback with file:line references.',
    tester: "You are a test engineer. Write comprehensive tests that cover edge cases, error paths, and happy paths. Use the project's existing test framework.",
    researcher:
        'You are a technical researcher. Investigate the codebase, documentation, and patterns to provide thorough, well-sourced answers.',
    debugger:
        'You are a debugging specialist. Systematically trace the root cause of the bug, verify your hypothesis, and apply a minimal fix. Explain your reasoning.',
};

/** Build a lean prompt for worker agents — role-first, no generic preamble. */
function buildWorkerPrompt(
    role: AgentRole,
    projectContext: string,
    depResults: string,
    task: TaskNode,
): string {
    const rolePrompt =
        WORKER_SYSTEM_PROMPTS[role] ?? WORKER_SYSTEM_PROMPTS.coder;
    const mode = task.mode ?? ROLE_MODE_MAP[role] ?? 'PLAN';

    const parts: string[] = [rolePrompt];
    if (mode === 'PLAN')
        parts.push('Mode: PLAN — read-only analysis. Do NOT make changes.');
    if (projectContext) parts.push(`## Project Context\n${projectContext}`);
    if (depResults) parts.push(`## Prerequisite Results\n${depResults}`);
    parts.push(`## Task\n${task.description}`);
    if (task.files.length > 0)
        parts.push(
            `## Relevant Files\n${task.files.map((f) => `- ${f}`).join('\n')}`,
        );
    return parts.join('\n\n');
}

const ROLE_MODE_MAP: Record<AgentRole, 'BUILD' | 'PLAN'> = {
    orchestrator: 'BUILD',
    coder: 'BUILD',
    reviewer: 'PLAN',
    tester: 'BUILD',
    researcher: 'PLAN',
    debugger: 'BUILD',
};

const WORKER_MAX_STEPS = 60;
/** Per-worker wall-clock timeout (5 minutes). Prevents stuck workers from blocking slots. */
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;
/** Max chars for immediate dependency results. */
const DEP_RESULT_FULL_MAX = 3000;
/** Max chars for transitive dependency results. */
const DEP_RESULT_SUMMARY_MAX = 500;
/**
 * Maximum total workers the orchestrator can spawn per graph.
 * Prevents runaway orchestration from burning excessive tokens.
 * Individual tasks beyond this cap are marked as cancelled.
 */
const MAX_TOTAL_WORKERS = 8;
/**
 * Task execution timeout. Workers get 5 minutes by default,
 * but tasks can override via maxDurationMs for complex operations.
 */
const TASK_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Build dependency results with compression and graceful degradation.
 * - Completed deps: full result (truncated at DEP_RESULT_FULL_MAX)
 * - Failed deps: warning + error message (worker can adapt)
 * - Cancelled deps: skip notice
 * - Degraded deps: truncated with [Partial] prefix
 */
function buildDependencyResults(task: TaskNode, graph: TaskGraph): string {
    return task.dependencies
        .map((depId) => {
            const dep = graph.nodes[depId];
            if (!dep) return null;

            if (dep.status === 'failed') {
                return `### ⚠️ Prerequisite "${dep.description}" FAILED\nError: ${dep.error}\nContinue without this context.`;
            }
            if (dep.status === 'cancelled') {
                return `### Prerequisite "${dep.description}" was cancelled. Continue without it.`;
            }
            if (dep.status === 'completed' && dep.result) {
                const prefix = dep.degraded ? '[Partial] ' : '';
                const maxLen = DEP_RESULT_FULL_MAX;
                const truncated =
                    dep.result.length > maxLen
                        ? dep.result.slice(0, maxLen) + '\n...[truncated]'
                        : dep.result;
                return `### ${prefix}Result: ${dep.description}\n\n${truncated}`;
            }
            return null;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');
}

export async function runWorker(
    task: TaskNode,
    graph: TaskGraph,
    projectContext: string,
    signal: AbortSignal,
): Promise<string> {
    const agentId = `worker-${task.id}`;
    const mode = task.mode ?? ROLE_MODE_MAP[task.type] ?? 'PLAN';
    // Use the parent model when available, otherwise fall back to role-based selection
    const resolvedModel =
        task.model ?? resolveProviderFallback(undefined, task.type);

    const auth = await getValidAuth();
    if (!auth) throw new Error('Not authenticated. Run /login to continue.');

    // Build task prompt with context from prerequisite tasks
    const depResults = buildDependencyResults(task, graph);

    const taskPrompt = buildWorkerPrompt(
        task.type,
        projectContext,
        depResults,
        task,
    );

    registerSubagent(agentId, task.description, WORKER_MAX_STEPS);

    // Combine external signal with per-worker timeout and task-specific abort signal
    const workerTimeoutMs = task.maxDurationMs ?? WORKER_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(workerTimeoutMs);
    const taskSignal = orchestratorManager.getTaskSignal(graph.id, task.id);
    const signals = [signal, timeoutSignal];
    if (taskSignal) {
        signals.push(taskSignal);
    }
    const combined = AbortSignal.any(signals);

    let startTime: number = 0;
    try {
        // Execute with optimized timeout for faster failure detection
        startTime = Date.now();
        const result = await runSubagentLoop({
            prompt: taskPrompt,
            mode,
            model: resolvedModel,
            auth,
            signal: combined,
            maxSteps: WORKER_MAX_STEPS,
            agentId,
            label: `worker-${task.id}`,
            maxRetries: 3,
        });
        const elapsed = Date.now() - startTime;
        // Enhanced provider latency tracking with task type information
        const provider = extractProvider(resolvedModel);
        if (provider) recordProviderLatency(provider, elapsed, true, mode);
        return result;
    } catch (error) {
        // Enhanced error handling with better logging for debugging
        const elapsed = Date.now() - startTime;
        const provider = extractProvider(resolvedModel);
        if (provider) recordProviderLatency(provider, elapsed, false, mode);
        console.error(`[worker-${task.id}] Worker failed:`, error);
        throw error;
    } finally {
        removeSubagent(agentId);
    }
}

export async function executeTaskGraph(
    graph: TaskGraph,
    projectContext: string,
    maxConcurrency: number,
    signal: AbortSignal,
    maxDurationMs?: number,
): Promise<string> {
    const controller = new AbortController();
    // Link the external signal to our internal controller
    if (signal.aborted) {
        controller.abort();
    } else {
        signal.addEventListener('abort', () => controller.abort(), {
            once: true,
        });
    }

    orchestratorManager.register(graph, controller);
    void syncTaskNodesToDb(graph);
    const results: Map<string, string> = new Map();
    const activeWorkers = new Map<string, Promise<void>>();

    // Apply maxDurationMs to all tasks if provided
    if (maxDurationMs) {
        for (const node of Object.values(graph.nodes)) {
            if (!node.maxDurationMs) node.maxDurationMs = maxDurationMs;
        }
    }

    // Event-driven signaling: resolve when ANY worker completes
    let resolveAnyWorkerDone: (() => void) | null = null;
    function signalWorkerDone() {
        resolveAnyWorkerDone?.();
    }

    // Subscribe to orchestratorManager updates to wake up the waiter when user edits tasks
    const unsubUpdate = orchestratorManager.subscribe(() => {
        signalWorkerDone();
    });

    // Single listener to propagate real-time tool info from subagent-progress to all running TaskNodes.
    const unsub = onSubagentChange(() => {
        const all = getActiveSubagents();
        let changed = false;
        for (const info of all) {
            if (!info.id.startsWith('worker-')) continue;
            const taskId = info.id.slice('worker-'.length);
            const node = graph.nodes[taskId];
            if (!node || node.status !== 'running') continue;
            node.currentTool = info.currentTool;
            node.currentToolInput = info.currentToolInput;
            if (Object.keys(info.toolsUsed).length > 0) {
                node.toolsUsed = { ...info.toolsUsed };
            }
            changed = true;
        }
        if (changed) {
            graph.version++;
            orchestratorManager.updateGraph(graph);
        }
    });

    // Adaptive concurrency: set per-provider limits based on the first worker's model
    const firstNode = Object.values(graph.nodes)[0];
    if (firstNode?.model) {
        setProviderConcurrency(extractProvider(firstNode.model));
    }

    const processReadyTasks = async (): Promise<void> => {
        while (graph.status === 'running') {
            if (controller.signal.aborted) {
                graph.status = 'cancelled';
                orchestratorManager.updateGraph(graph);
                break;
            }

            const readyTasks = getReadyTasks(graph);
            if (readyTasks.length === 0 && activeWorkers.size === 0) {
                const hasPendingOrPaused = Object.values(graph.nodes).some(
                    (n) => n.status === 'pending' || n.status === 'paused',
                );
                if (hasPendingOrPaused && !controller.signal.aborted) {
                    await new Promise<void>((resolve) => {
                        resolveAnyWorkerDone = resolve;
                        controller.signal.addEventListener('abort', () => resolve(), {
                            once: true,
                        });
                    });
                    resolveAnyWorkerDone = null;
                    continue;
                } else {
                    break; // Nothing to run and nothing running
                }
            }

            // Critical path prioritization
            const cp = getCriticalPath(graph);
            if (cp.length > 0) {
                const cpSet = new Set(cp);
                readyTasks.sort(
                    (a, b) =>
                        (cpSet.has(a.id) ? 0 : 1) - (cpSet.has(b.id) ? 0 : 1),
                );
            } else {
                const depth = new Map<string, number>();
                for (const id of getTopologicalOrder(graph)) {
                    const node = graph.nodes[id];
                    if (!node) continue;
                    depth.set(
                        id,
                        node.dependencies.reduce(
                            (max, d) => Math.max(max, (depth.get(d) ?? 0) + 1),
                            0,
                        ),
                    );
                }
                readyTasks.sort(
                    (a, b) => (depth.get(b.id) ?? 0) - (depth.get(a.id) ?? 0),
                );
            }

            // Start ready tasks (respect concurrency limit)
            const totalSpawned = Object.values(graph.nodes).filter(
                (n) => n.status !== 'pending',
            ).length;
            for (const task of readyTasks) {
                if (activeWorkers.size >= maxConcurrency) break;
                if (totalSpawned >= MAX_TOTAL_WORKERS) {
                    const remaining = Object.values(graph.nodes).filter(
                        (n) => n.status === 'pending',
                    );
                    for (const r of remaining) {
                        r.status = 'cancelled';
                        r.completedAt = Date.now();
                        void updateTaskNodeInDb(graph.id, r.id, { status: 'cancelled' });
                    }
                    debug.log(
                        'orchestrator',
                        `Capped orchestration at ${MAX_TOTAL_WORKERS} total workers, cancelled ${remaining.length} pending tasks`,
                    );
                    const allDone = Object.values(graph.nodes).every(
                        (n) =>
                            n.status === 'completed' ||
                            n.status === 'failed' ||
                            n.status === 'cancelled',
                    );
                    if (allDone) {
                        const hasCompleted = Object.values(graph.nodes).some(
                            (n) => n.status === 'completed',
                        );
                        graph.status = hasCompleted ? 'completed' : 'cancelled';
                        graph.completedAt = Date.now();
                    }
                    break;
                }
                if (activeWorkers.has(task.id)) continue;

                markTaskRunning(graph, task.id);
                void updateTaskNodeInDb(graph.id, task.id, { status: 'running' });
                debug.log(
                    'orchestrator',
                    `Starting worker: ${task.id} (${task.type}) — deps=[${task.dependencies.join(', ')}] ready=${readyTasks.map((t) => t.id).join(', ')}`,
                );
                orchestratorManager.updateGraph(graph);
                orchestratorManager.incrementWorker(graph.id);

                const workerAgentId = `worker-${task.id}`;
                const workerStartedAt = Date.now();

                const taskController = new AbortController();
                orchestratorManager.registerTaskAbortController(graph.id, task.id, taskController);

                const workerPromise = (async () => {
                    if (!acquireSlot()) {
                        throw new Error('Concurrency limit reached');
                    }
                    try {
                        return await runWorker(
                            task,
                            graph,
                            projectContext,
                            controller.signal,
                        );
                    } finally {
                        releaseSlot();
                    }
                })()
                    .then((result) => {
                        const subagentInfo = getActiveSubagents().find(
                            (s) => s.id === workerAgentId,
                        );
                        if (
                            subagentInfo?.toolsUsed &&
                            Object.keys(subagentInfo.toolsUsed).length > 0
                        ) {
                            task.toolsUsed = { ...subagentInfo.toolsUsed };
                        }
                        task.currentTool = null;
                        task.currentToolInput = null;
                        markTaskCompleted(graph, task.id, result);
                        void updateTaskNodeInDb(graph.id, task.id, {
                            status: 'completed',
                            result,
                        });
                        results.set(
                            task.id,
                            `### ${task.description}\n\n${result}`,
                        );
                        debug.log(
                            'orchestrator',
                            `Task ${task.id} completed: ${task.description}`,
                        );
                        const provider = extractProvider(task.model ?? '');
                        if (provider)
                            recordProviderLatency(
                                provider,
                                Date.now() - workerStartedAt,
                                true,
                                task.mode,
                            );
                        // Broadcast completion for inter-worker awareness
                        messageBroker.publish({
                            from: workerAgentId,
                            to: '*',
                            type: 'task-result',
                            payload: {
                                taskId: task.id,
                                summary: result.slice(0, 200),
                            },
                        });
                        // Persist result to workspace
                        writeResult(graph.id, task.id, result).catch(() => {});
                    })
                    .catch((error) => {
                        const msg =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        if (task.status === 'completed') {
                            // Manually force-completed, do not overwrite
                            return;
                        }
                        if (task.status === 'paused' || task.status === 'cancelled') {
                            task.error = msg;
                            task.completedAt = Date.now();
                            graph.version++;
                            void updateTaskNodeInDb(graph.id, task.id, {
                                status: task.status,
                                error: msg,
                            });
                        } else {
                            markTaskFailed(graph, task.id, msg);
                            void updateTaskNodeInDb(graph.id, task.id, {
                                status: 'failed',
                                error: msg,
                            });
                        }
                        debug.log(
                            'orchestrator',
                            `Task ${task.id} failed: ${msg}`,
                        );
                        const provider = extractProvider(task.model ?? '');
                        if (provider)
                            recordProviderLatency(
                                provider,
                                Date.now() - workerStartedAt,
                                false,
                                task.mode,
                            );
                    })
                    .finally(() => {
                        activeWorkers.delete(task.id);
                        orchestratorManager.unregisterTaskAbortController(graph.id, task.id);
                        orchestratorManager.completeWorker(graph.id);
                        orchestratorManager.updateGraph(graph);
                        signalWorkerDone(); // Signal: something finished
                    });

                activeWorkers.set(task.id, workerPromise);
            }

            // Wait for ANY worker to complete (not ALL)
            if (activeWorkers.size > 0) {
                await new Promise<void>((resolve) => {
                    resolveAnyWorkerDone = resolve;
                    // Also resolve on abort so we don't hang
                    if (controller.signal.aborted) {
                        resolve();
                        return;
                    }
                    controller.signal.addEventListener(
                        'abort',
                        () => resolve(),
                        { once: true },
                    );
                });
                resolveAnyWorkerDone = null;
            }
        }
    };

    try {
        await processReadyTasks();
    } catch (error) {
        if (graph.status === 'running') {
            graph.status = 'failed';
            orchestratorManager.updateGraph(graph);
        }
        throw error;
    } finally {
        unsub();
        unsubUpdate();
    }

    orchestratorManager.updateGraph(graph);

    // Merge results
    const stats = {
        total: Object.keys(graph.nodes).length,
        completed: Object.values(graph.nodes).filter(
            (n) => n.status === 'completed',
        ).length,
        failed: Object.values(graph.nodes).filter((n) => n.status === 'failed')
            .length,
        degraded: Object.values(graph.nodes).filter((n) => n.degraded).length,
    };

    try {
        const { cleanupWorkspace } = await import('@/lib/workspace');
        await cleanupWorkspace(graph.id);
    } catch (cleanupError) {
        debug.log(
            'orchestrator',
            `Workspace cleanup failed for graph ${graph.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
    }

    return [
        `## Orchestration Complete`,
        ``,
        `**${stats.completed}/${stats.total}** tasks completed` +
            (stats.failed > 0 ? ` (${stats.failed} failed)` : '') +
            (stats.degraded > 0 ? ` (${stats.degraded} degraded)` : ''),
        ``,
        `### Results`,
        ``,
        (() => {
            const order = getTopologicalOrder(graph);
            return [...results.entries()]
                .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
                .map(([, text]) => text)
                .join('\n\n---\n\n');
        })(),
    ].join('\n');
}

async function syncTaskNodesToDb(graph: TaskGraph) {
    try {
        const { lastSession } = await import('@/index');
        const sessionId = lastSession.id;
        if (!sessionId) return;

        const { apiClient } = await import('@/lib/api-client');
        await apiClient.orchestrator.sessions[':sessionId'].graphs[':graphId'].nodes.$post({
            param: { sessionId, graphId: graph.id },
            json: {
                nodes: Object.values(graph.nodes).map((n) => ({
                    id: n.id,
                    graphId: graph.id,
                    type: n.type,
                    description: n.description,
                    dependencies: n.dependencies,
                    status: n.status,
                    result: n.result,
                    error: n.error,
                    files: n.files,
                })),
            },
        });
    } catch (err) {
        debug.log('orchestrator', `Failed to sync task nodes for graph ${graph.id} to DB: ${err}`);
    }
}

async function updateTaskNodeInDb(
    graphId: string,
    nodeId: string,
    update: {
        status?: string;
        result?: string | null;
        error?: string | null;
        description?: string;
        files?: string[];
    }
) {
    try {
        const { lastSession } = await import('@/index');
        const sessionId = lastSession.id;
        if (!sessionId) return;

        const { apiClient } = await import('@/lib/api-client');
        await apiClient.orchestrator.sessions[':sessionId'].graphs[':graphId'].nodes[':nodeId'].$put({
            param: { sessionId, graphId, nodeId },
            json: update,
        });
    } catch (err) {
        debug.log('orchestrator', `Failed to update task node ${nodeId} in DB: ${err}`);
    }
}
