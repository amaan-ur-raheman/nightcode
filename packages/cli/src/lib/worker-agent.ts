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
import {
    calculateTaskPriority,
    getRetryStrategy,
} from '@/lib/orchestrator-intelligence';
import { correctionTracker } from '@/lib/correction-tracker';
import { errorPatternTracker } from '@/lib/error-pattern-tracker';

const WORKER_SYSTEM_PROMPTS: Record<AgentRole, string> = {
    orchestrator:
        'You are an orchestrator agent managing a team of specialized workers.',
    coder: 'You are an expert software engineer. Implement the assigned coding task precisely. Write clean, production-quality code. Read all relevant files before modifying. Verify your work by reading the files you modified and running appropriate checks. Accuracy over speed - one correct change is better than three wrong ones.',
    reviewer:
        'You are a senior code reviewer. Analyze the code for bugs, security issues, performance problems, and adherence to best practices. Provide specific, actionable feedback with file:line references. Read the full files you review — don’t guess at context.',
    tester: "You are a test engineer. Write comprehensive tests that cover edge cases, error paths, and happy paths. Use the project's existing test framework. Run the tests after writing them to confirm they pass.",
    researcher:
        'You are a technical researcher. Investigate the codebase, documentation, and patterns to provide thorough, well-sourced answers. Cite file paths and line numbers for all findings.',
    debugger:
        'You are a debugging specialist. Systematically trace the root cause of the bug by reading the relevant code paths. Form a hypothesis, test it, and apply a minimal fix. Explain your reasoning at each step.',
};

/** Build a lean prompt for worker agents — role-first, no generic preamble. */
function buildWorkerPrompt(
    role: AgentRole,
    projectContext: string,
    depResults: string,
    task: TaskNode,
    positives?: string[],
    errorWarnings?: string[],
): string {
    const rolePrompt =
        WORKER_SYSTEM_PROMPTS[role] ?? WORKER_SYSTEM_PROMPTS.coder;
    const mode = task.mode ?? ROLE_MODE_MAP[role] ?? 'PLAN';

    const parts: string[] = [rolePrompt];
    if (mode === 'PLAN')
        parts.push('Mode: PLAN — read-only analysis. Do NOT make changes.');
    if (projectContext) parts.push(`## Project Context\n${projectContext}`);
    if (depResults) parts.push(`## Prerequisite Results\n${depResults}`);
    if (positives && positives.length > 0) {
        parts.push(
            `## Proven Patterns\n${positives.map((p) => `- ${p}`).join('\n')}`,
        );
    }
    if (errorWarnings && errorWarnings.length > 0) {
        parts.push(
            `## ⚠️ Recurring Errors\n${errorWarnings.map((w) => `- ${w}`).join('\n')}`,
        );
    }
    parts.push(`## Task\n${task.description}`);
    if (task.files.length > 0)
        parts.push(
            `## Relevant Files\n${task.files.map((f) => `- ${f}`).join('\n')}`,
        );
    // Inject performance hints from past runs of this role
    const hints = performanceTracker.getHintsForRole(role);
    if (hints) parts.push(hints);
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

// ── Worker Performance Feedback Loop ──
const PERF_HISTORY_MAX = 100;

interface RolePerformance {
    successes: number;
    failures: number;
    totalTokens: number;
    avgDurationMs: number;
    /** Last failure reason — to avoid repeating the same mistake */
    lastFailureReason: string;
    /** Last failure timestamp — for time-decay of hints */
    lastFailureAt: number;
}

class WorkerPerformanceTracker {
    private history = new Map<string, RolePerformance>();

    recordSuccess(role: AgentRole, durationMs: number, tokens?: number): void {
        const perf = this.getOrCreate(role);
        perf.successes++;
        perf.avgDurationMs =
            (perf.avgDurationMs * (perf.successes + perf.failures - 1) +
                durationMs) /
            (perf.successes + perf.failures);
        if (tokens) perf.totalTokens += tokens;
    }

    recordFailure(role: AgentRole, reason: string, durationMs: number): void {
        const perf = this.getOrCreate(role);
        perf.failures++;
        perf.lastFailureReason = reason;
        perf.lastFailureAt = Date.now();
        perf.avgDurationMs =
            (perf.avgDurationMs * (perf.successes + perf.failures - 1) +
                durationMs) /
            (perf.successes + perf.failures);
    }

    /** Generate role-specific hints from past performance. */
    getHintsForRole(role: AgentRole): string {
        const perf = this.history.get(role);
        if (!perf || perf.successes + perf.failures < 3) return '';

        const hints: string[] = [];
        const successRate = perf.successes / (perf.successes + perf.failures);

        if (successRate < 0.5) {
            hints.push(
                `Past ${role} workers failed ${perf.failures} times with ${Math.round(successRate * 100)}% success rate. Focus on accuracy over speed.`,
            );
        }

        if (
            perf.lastFailureReason &&
            Date.now() - perf.lastFailureAt < 3_600_000
        ) {
            // Decay: only show hint if failure was within the last hour
            hints.push(
                `Recent failure pattern for this role: "${perf.lastFailureReason}". Avoid this mistake.`,
            );
        }

        return hints.length > 0
            ? `\n\n### Performance Hints\n${hints.map((h) => `- ${h}`).join('\n')}`
            : '';
    }

    private getOrCreate(role: AgentRole): RolePerformance {
        let perf = this.history.get(role);
        if (!perf) {
            perf = {
                successes: 0,
                failures: 0,
                totalTokens: 0,
                avgDurationMs: 0,
                lastFailureReason: '',
                lastFailureAt: 0,
            };
            this.history.set(role, perf);
        }
        return perf;
    }

    /** Get summary stats for diagnostics. */
    getStats(): Record<string, { successRate: number; avgDuration: number }> {
        const stats: Record<
            string,
            { successRate: number; avgDuration: number }
        > = {};
        for (const [role, perf] of this.history) {
            const total = perf.successes + perf.failures;
            stats[role] = {
                successRate: total > 0 ? perf.successes / total : 1,
                avgDuration: perf.avgDurationMs,
            };
        }
        return stats;
    }

    clear(): void {
        this.history.clear();
    }
}

const performanceTracker = new WorkerPerformanceTracker();

const WORKER_MAX_STEPS = 60;
/** Base per-worker wall-clock timeout (5 minutes). Prevents stuck workers from blocking slots. */
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;
/** Additional time per file referenced by the task (complexity scaling). */
const TIMEOUT_PER_FILE_MS = 30 * 1000;
/** Maximum worker timeout cap. */
const WORKER_TIMEOUT_MAX_MS = 15 * 60 * 1000;
/** Max chars for immediate dependency results. */
const DEP_RESULT_FULL_MAX = 3000;
/**
 * Maximum total workers the orchestrator can spawn per graph.
 * Prevents runaway orchestration from burning excessive tokens.
 * Individual tasks beyond this cap are marked as cancelled.
 */
const MAX_TOTAL_WORKERS = 8;

// ── Adaptive Worker Timeout: Latency History Tracker ──
const LATENCY_HISTORY_MAX = 50; // Keep last N latencies per task type
const LATENCY_PERCENTILE = 0.95; // p95
const LATENCY_MULTIPLIER = 3; // Timeout = 3x p95

interface LatencyEntry {
    durationMs: number;
    timestamp: number;
}

class WorkerLatencyTracker {
    private history = new Map<string, LatencyEntry[]>();

    record(taskType: string, durationMs: number): void {
        const entries = this.history.get(taskType) ?? [];
        entries.push({ durationMs, timestamp: Date.now() });
        // Keep only recent entries
        if (entries.length > LATENCY_HISTORY_MAX) {
            entries.splice(0, entries.length - LATENCY_HISTORY_MAX);
        }
        this.history.set(taskType, entries);
    }

    /**
     * Get the adaptive timeout for a task type based on p95 latency.
     * Returns null if insufficient data (< 5 samples).
     */
    getAdaptiveTimeout(taskType: string): number | null {
        const entries = this.history.get(taskType);
        if (!entries || entries.length < 5) return null;

        const sorted = [...entries]
            .map((e) => e.durationMs)
            .sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * LATENCY_PERCENTILE);
        const p95 = sorted[Math.min(p95Index, sorted.length - 1)]!;

        return Math.min(p95 * LATENCY_MULTIPLIER, WORKER_TIMEOUT_MAX_MS);
    }

    /** Clear all history (useful for tests). */
    clear(): void {
        this.history.clear();
    }
}

const latencyTracker = new WorkerLatencyTracker();

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
                return `### [WARNING] Prerequisite "${dep.description}" FAILED\nError: ${dep.error}\nContinue without this context.`;
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

/**
 * Check if an error is transient (worth retrying).
 * Transient errors: rate limits, timeouts, connection resets, 5xx server errors.
 * Non-transient: auth failures, permission errors, file not found, syntax errors.
 */
function isTransientError(error: any): boolean {
    const message = error?.message?.toLowerCase() || '';

    // Rate limits — always retry
    if (
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('too many requests')
    ) {
        return true;
    }

    // Connection / network errors — retry
    if (
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('etimedout') ||
        message.includes('fetch failed') ||
        message.includes('network')
    ) {
        return true;
    }

    // Timeout — retry
    if (message.includes('timeout') || message.includes('timed out')) {
        return true;
    }

    // Server errors (5xx) — retry
    if (
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')
    ) {
        return true;
    }

    // Heartbeat timeout — the connection hung, retry
    if (message.includes('heartbeat timeout')) {
        return true;
    }

    return false;
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

    // Gather learning signals for the prompt
    const [corrections, patterns, errorSuggestions] = await Promise.all([
        correctionTracker.getCorrections(),
        correctionTracker.getPatterns(),
        Promise.resolve(errorPatternTracker.getSuggestions()),
    ]);

    const taskPrompt = buildWorkerPrompt(
        task.type,
        projectContext,
        depResults,
        task,
        patterns.positives,
        errorSuggestions,
    );

    registerSubagent(agentId, task.description, WORKER_MAX_STEPS);

    // Combine external signal with per-worker timeout and task-specific abort signal
    // Adaptive timeout: use latency history if available, otherwise scale by complexity
    const adaptiveTimeout = latencyTracker.getAdaptiveTimeout(task.type);
    const baseTimeout = task.maxDurationMs ?? WORKER_TIMEOUT_MS;
    const complexityBonus = Math.min(
        task.files.length * TIMEOUT_PER_FILE_MS,
        Math.max(0, WORKER_TIMEOUT_MAX_MS - baseTimeout),
    );
    const staticTimeout = Math.min(
        baseTimeout + complexityBonus,
        WORKER_TIMEOUT_MAX_MS,
    );
    // Use adaptive timeout if we have enough history; otherwise use static formula
    const workerTimeoutMs = adaptiveTimeout ?? staticTimeout;
    const timeoutSignal = AbortSignal.timeout(workerTimeoutMs);
    const taskSignal = orchestratorManager.getTaskSignal(graph.id, task.id);
    const signals = [signal, timeoutSignal];
    if (taskSignal) {
        signals.push(taskSignal);
    }
    const combined = AbortSignal.any(signals);

    let startTime: number = 0;
    const retryStrategy = getRetryStrategy(task.type);
    const maxWorkerRetries = retryStrategy.maxRetries;
    let lastError: any;

    try {
        for (let attempt = 0; attempt <= maxWorkerRetries; attempt++) {
            try {
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
                    errorTracker: errorPatternTracker,
                });
                const elapsed = Date.now() - startTime;
                const provider = extractProvider(resolvedModel);
                if (provider)
                    recordProviderLatency(provider, elapsed, true, mode);
                latencyTracker.record(task.type, elapsed);
                performanceTracker.recordSuccess(task.type, elapsed);
                return result;
            } catch (error) {
                lastError = error;
                const elapsed = Date.now() - startTime;
                const provider = extractProvider(resolvedModel);
                if (provider)
                    recordProviderLatency(provider, elapsed, false, mode);
                latencyTracker.record(task.type, elapsed);
                const failureReason =
                    error instanceof Error
                        ? error.message.slice(0, 200)
                        : String(error).slice(0, 200);
                performanceTracker.recordFailure(
                    task.type,
                    failureReason,
                    elapsed,
                );

                // Don't retry for non-transient errors
                if (!isTransientError(error) || attempt >= maxWorkerRetries) {
                    console.error(
                        `[worker-${task.id}] Worker failed after ${attempt + 1} attempt(s):`,
                        error,
                    );
                    throw error;
                }

                // Exponential backoff before retry
                const delay = Math.min(
                    retryStrategy.baseDelayMs *
                        Math.pow(retryStrategy.backoffMultiplier, attempt),
                    retryStrategy.maxDelayMs,
                );
                console.log(
                    `[worker-${task.id}] Transient error, retrying in ${delay}ms (attempt ${attempt + 2}/${maxWorkerRetries + 1}): ${error instanceof Error ? error.message : String(error)}`,
                );
                debug.log(
                    `worker-${task.id}`,
                    `Retrying after transient error: ${error instanceof Error ? error.message : String(error)}`,
                );
                await new Promise<void>((resolve) => {
                    const t = setTimeout(resolve, delay);
                    combined.addEventListener(
                        'abort',
                        () => {
                            clearTimeout(t);
                            resolve();
                        },
                        { once: true },
                    );
                });
                // If signal was aborted during delay, don't retry
                if (combined.aborted) break;
            }
        }

        throw lastError;
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
                        controller.signal.addEventListener(
                            'abort',
                            () => resolve(),
                            {
                                once: true,
                            },
                        );
                    });
                    resolveAnyWorkerDone = null;
                    continue;
                } else {
                    break; // Nothing to run and nothing running
                }
            }

            // Priority-based scheduling: use calculateTaskPriority for smarter ordering
            const cp = getCriticalPath(graph);
            readyTasks.sort(
                (a, b) =>
                    calculateTaskPriority(b, graph, cp) -
                    calculateTaskPriority(a, graph, cp),
            );

            // Start ready tasks (respect concurrency limit)
            for (const task of readyTasks) {
                if (activeWorkers.size >= maxConcurrency) break;
                const totalSpawned = Object.values(graph.nodes).filter(
                    (n) => n.status !== 'pending',
                ).length;
                if (totalSpawned >= MAX_TOTAL_WORKERS) {
                    const remaining = Object.values(graph.nodes).filter(
                        (n) => n.status === 'pending',
                    );
                    for (const r of remaining) {
                        r.status = 'cancelled';
                        r.completedAt = Date.now();
                        void updateTaskNodeInDb(graph.id, r.id, {
                            status: 'cancelled',
                        });
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
                void updateTaskNodeInDb(graph.id, task.id, {
                    status: 'running',
                });
                debug.log(
                    'orchestrator',
                    `Starting worker: ${task.id} (${task.type}) — deps=[${task.dependencies.join(', ')}] ready=${readyTasks.map((t) => t.id).join(', ')}`,
                );
                orchestratorManager.updateGraph(graph);
                orchestratorManager.incrementWorker(graph.id);

                const workerAgentId = `worker-${task.id}`;
                const workerStartedAt = Date.now();

                const taskController = new AbortController();
                orchestratorManager.registerTaskAbortController(
                    graph.id,
                    task.id,
                    taskController,
                );

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
                        if (
                            task.status === 'paused' ||
                            task.status === 'cancelled'
                        ) {
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
                    })
                    .finally(() => {
                        activeWorkers.delete(task.id);
                        orchestratorManager.unregisterTaskAbortController(
                            graph.id,
                            task.id,
                        );
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
        await apiClient.orchestrator.sessions[':sessionId'].graphs[
            ':graphId'
        ].nodes.$post({
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
        debug.log(
            'orchestrator',
            `Failed to sync task nodes for graph ${graph.id} to DB: ${err}`,
        );
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
    },
) {
    try {
        const { lastSession } = await import('@/index');
        const sessionId = lastSession.id;
        if (!sessionId) return;

        const { apiClient } = await import('@/lib/api-client');
        await apiClient.orchestrator.sessions[':sessionId'].graphs[
            ':graphId'
        ].nodes[':nodeId'].$put({
            param: { sessionId, graphId, nodeId },
            json: update,
        });
    } catch (err) {
        debug.log(
            'orchestrator',
            `Failed to update task node ${nodeId} in DB: ${err}`,
        );
    }
}

/**
 * Resume a previously crashed/aborted task graph from its checkpoint.
 *
 * Loads the checkpoint, preserves completed task results, and re-executes
 * only the pending/failed tasks. Returns a summary of all results.
 */
export async function resumeTaskGraph(
    graphId: string,
    projectContext: string,
    maxConcurrency: number,
    signal: AbortSignal,
    maxDurationMs?: number,
): Promise<string> {
    const { loadCheckpoint } = await import('@/lib/orchestrator-manager');
    const { getCompletedResults } = await import('@nightcode/shared');

    const graph = await loadCheckpoint(graphId);
    if (!graph) {
        throw new Error(`No checkpoint found for graph ${graphId}`);
    }

    const completedResults = getCompletedResults(graph);
    const completedCount = Object.keys(completedResults).length;
    const totalCount = Object.keys(graph.nodes).length;
    debug.log(
        'orchestrator',
        `Resuming graph ${graphId}: ${completedCount}/${totalCount} tasks already completed`,
    );

    // Reset non-completed tasks to pending
    for (const node of Object.values(graph.nodes)) {
        if (node.status !== 'completed') {
            node.status = 'pending';
            node.error = undefined;
            node.retryCount = 0;
        }
    }

    // Reset graph status so the while-loop in executeTaskGraph can run
    graph.status = 'running';

    // Bump version so UI refreshes
    graph.version++;

    // Execute with the restored graph — completed tasks will be skipped by getReadyTasks
    return executeTaskGraph(
        graph,
        projectContext,
        maxConcurrency,
        signal,
        maxDurationMs,
    );
}
