import {
    toolInputSchemas,
    type ModeType,
    resolveProviderForModel,
} from '@nightcode/shared';
import {
    createTaskGraph,
    validateGraph,
    type TaskGraph,
} from '@nightcode/shared';
import { executeTaskGraph } from '@/lib/worker-agent';
import { orchestratorManager } from '@/lib/orchestrator-manager';
import {
    getCurrentToolCallContext,
    consumeExecutionContext,
} from '@/lib/subagent-progress';
import { debug } from '@/lib/debug';
import { resolveProviderFallback } from '@/lib/model-utils';
import { setOrchestrationActive } from '@/lib/api-client';
import { getApiKeyForProvider } from '@/lib/api-keys';

export async function orchestratorTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
): Promise<unknown> {
    const { task, context, strategy, maxConcurrency, maxDurationMs } =
        toolInputSchemas.orchestrator.parse(input);

    if (parentMode === 'PLAN') {
        throw new Error(
            'Orchestrator requires BUILD mode. Switch to BUILD mode to use orchestration.',
        );
    }

    debug.log('orchestrator', `Starting orchestration: "${task}"`, {
        strategy,
        maxConcurrency,
    });

    // Mark orchestration as active to prevent auth clearing during execution
    setOrchestrationActive(true);

    try {
        // Skip LLM decomposition for simple tasks — save 5-6s latency + ~1.5K tokens
        let graph: TaskGraph;
        if (isSimpleTask(task)) {
            graph = buildSimpleGraph(task, parentModel);
            debug.log(
                'orchestrator',
                `Simple task — skipped decomposition, created ${Object.keys(graph.nodes).length} tasks`,
            );
        } else {
            // Use LLM to decompose the task into a DAG (L2: with retry)
            graph = await decomposeTask(
                task,
                context,
                strategy,
                parentModel,
                signal,
            );
        }

        const validationErrors = validateGraph(graph);
        if (validationErrors.length > 0) {
            throw new Error(
                `Invalid task graph: ${validationErrors.join('; ')}`,
            );
        }

        debug.log(
            'orchestrator',
            `Decomposed into ${Object.keys(graph.nodes).length} tasks`,
        );
        // Log dependency graph for debugging parallelism
        for (const node of Object.values(graph.nodes)) {
            debug.log(
                'orchestrator',
                `  [${node.id}] ${node.type}: deps=[${node.dependencies.join(', ')}]`,
            );
        }

        // Set toolCallId context so orchestratorManager can map toolCallId → graphId
        const toolCallId = execId
            ? (consumeExecutionContext(execId) ?? null)
            : getCurrentToolCallContext();
        orchestratorManager.setCurrentToolCallContext(toolCallId);

        // Execute the graph — executeTaskGraph handles registration with orchestratorManager
        const result = await executeTaskGraph(
            graph,
            context ?? '',
            maxConcurrency,
            signal ?? AbortSignal.timeout(30 * 60 * 1000),
            maxDurationMs,
        );
        return `Orchestration complete (${graph.id}).\n${stringify(result)}`;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        debug.log('orchestrator', `Execution failed: ${msg}`);
        return `Orchestration failed: ${msg}`;
    } finally {
        setOrchestrationActive(false);
    }
}

async function decomposeTask(
    task: string,
    context: string | undefined,
    strategy: string,
    model: string | undefined,
    signal?: AbortSignal,
    maxAttempts = 2,
): Promise<TaskGraph> {
    const API_URL = process.env.API_URL ?? 'http://localhost:3000';

    let lastError: Error | null = null;

    // H3: Valid task roles for LLM decomposition validation
    const VALID_ROLES = new Set([
        'coder',
        'reviewer',
        'tester',
        'researcher',
        'debugger',
        'orchestrator',
    ]);
    const MAX_DECOMPOSED_TASKS = 10;

    // L2: Retry decomposition up to maxAttempts before falling back
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const auth = await (await import('@/lib/auth')).getValidAuth();
            if (!auth) throw new Error('Not authenticated');

            // Resolve provider API key to send with the request
            const resolvedModel =
                model ?? resolveProviderFallback(model, 'coder');
            const providerKey = await (async () => {
                try {
                    const provider = resolveProviderForModel(resolvedModel);
                    return await getApiKeyForProvider(provider);
                } catch {
                    return null;
                }
            })();

            const decomposeHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${auth.token}`,
            };
            if (providerKey) {
                decomposeHeaders['x-provider-key'] = providerKey;
            }

            const response = await fetch(`${API_URL}/orchestrator/decompose`, {
                method: 'POST',
                headers: decomposeHeaders,
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    type: 'text',
                                    text:
                                        task +
                                        (context
                                            ? `\n\nContext: ${context}`
                                            : ''),
                                },
                            ],
                        },
                    ],
                    model: resolvedModel,
                    mode: 'BUILD',
                    strategy,
                }),
                signal, // #5: propagate abort signal to decompose fetch
            });

            if (!response.ok)
                throw new Error(`Decomposition failed: ${response.status}`);

            const text = await response.text();

            // #4: Improved JSON extraction — try ```json blocks first, then array match
            const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
            const jsonSource = codeBlockMatch?.[1] ?? text;
            const jsonMatch = jsonSource.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                throw new Error(
                    'Could not parse decomposition from LLM response',
                );
            }

            let tasks = JSON.parse(jsonMatch[0]) as Array<{
                id: string;
                type: string;
                description: string;
                dependencies: string[];
                files: string[];
                mode: string;
            }>;

            // H3: Validate task types from LLM decomposition
            for (const t of tasks) {
                if (!VALID_ROLES.has(t.type)) {
                    debug.log(
                        'orchestrator',
                        `Invalid task type "${t.type}" in task "${t.id}", defaulting to "coder"`,
                    );
                    t.type = 'coder';
                }
            }

            // Cap the number of tasks to prevent runaway decomposition
            if (tasks.length > MAX_DECOMPOSED_TASKS) {
                debug.log(
                    'orchestrator',
                    `Decomposition produced ${tasks.length} tasks, capping to ${MAX_DECOMPOSED_TASKS}`,
                );
                // Keep only the first MAX_DECOMPOSED_TASKS tasks and remove their dependents
                const keptIds = new Set(
                    tasks.slice(0, MAX_DECOMPOSED_TASKS).map((t) => t.id),
                );
                tasks = tasks.slice(0, MAX_DECOMPOSED_TASKS);
                // Remove any remaining dependencies on removed tasks
                for (const t of tasks) {
                    t.dependencies = t.dependencies.filter((d) =>
                        keptIds.has(d),
                    );
                }
            }

            return createTaskGraph(
                task,
                tasks.map((t) => ({
                    id: t.id,
                    type: t.type as any,
                    description: t.description,
                    dependencies: t.dependencies,
                    files: t.files ?? [],
                    mode: (t.mode ?? 'PLAN') as 'BUILD' | 'PLAN',
                    model: model,
                    maxRetries: 2,
                })),
            );
        } catch (error) {
            lastError =
                error instanceof Error ? error : new Error(String(error));
            debug.log(
                'orchestrator',
                `Decomposition attempt ${attempt + 1}/${maxAttempts} failed: ${lastError.message}`,
            );
            if (attempt < maxAttempts - 1) {
                // Brief delay before retry
                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }

    // All attempts failed — fallback to single-node graph
    debug.log(
        'orchestrator',
        `All decomposition attempts failed, using fallback: ${lastError?.message}`,
    );
    return createTaskGraph(task, [
        {
            id: 'main-task',
            type: 'coder',
            description: task,
            dependencies: [],
            files: [],
            mode: 'BUILD',
            model: model,
            maxRetries: 2, // Fallback coder should still retry on transient failures
        },
    ]);
}

/**
 * Detect tasks simple enough to skip LLM decomposition.
 * Short descriptions with explicit file references or comma-separated subtasks.
 */
function isSimpleTask(task: string): boolean {
    if (task.length > 200) return false;
    // Source file references (not URLs, versions, or random dotted strings)
    const srcFileRefs = (
        task.match(
            /(?:\.\/|\.\.\/|\w+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)/g,
        ) ?? []
    ).length;
    if (srcFileRefs >= 2) return true;
    // Explicit conjunctions like "and" / "," between short phrases
    const phrases = task.split(/\s*(?:and|then|also)\s+/i).filter(Boolean);
    if (phrases.length >= 2 && phrases.length <= 4 && task.length < 150)
        return true;
    return false;
}

function buildSimpleGraph(task: string, model: string | undefined): TaskGraph {
    const phrases = task.split(/\s*(?:and|then|also|,\s*)\s+/i).filter(Boolean);
    if (phrases.length >= 2 && phrases.length <= 4) {
        // Detect sequential vs parallel: "then" implies dependency,
        // ","/"and" with no cross-references implies parallel.
        const hasSequentialMarker = /\bthen\b/i.test(task);
        return createTaskGraph(
            task,
            phrases.map((phrase, i) => ({
                id: `task-${i + 1}`,
                type: 'coder' as const,
                description: phrase.trim(),
                dependencies: hasSequentialMarker && i > 0 ? [`task-${i}`] : [],
                files: [],
                mode: 'BUILD' as const,
                model,
                maxRetries: 2,
            })),
        );
    }
    // Single task — no decomposition needed
    return createTaskGraph(task, [
        {
            id: 'main-task',
            type: 'coder',
            description: task,
            dependencies: [],
            files: [],
            mode: 'BUILD',
            model,
            maxRetries: 2,
        },
    ]);
}

export async function getTaskStatusTool(input: unknown): Promise<unknown> {
    const { graphId } = toolInputSchemas.getTaskStatus.parse(input);

    if (graphId) {
        const state = orchestratorManager.get(graphId);
        if (!state) return `No orchestration found with ID: ${graphId}`;
        return formatGraphStatus(state.graph);
    }

    const all = orchestratorManager.getAll();
    if (all.length === 0) return 'No active orchestrations.';

    return all.map((s) => formatGraphStatus(s.graph)).join('\n\n');
}

export async function cancelTaskTool(input: unknown): Promise<unknown> {
    const { graphId, taskId } = toolInputSchemas.cancelTask.parse(input);

    const state = orchestratorManager.get(graphId);
    if (!state) return `No orchestration found with ID: ${graphId}`;

    const { cancelTask } = await import('@nightcode/shared');

    if (taskId) {
        cancelTask(state.graph, taskId);
    } else {
        // Cancel the entire orchestration
        for (const node of Object.values(state.graph.nodes)) {
            if (node.status === 'pending' || node.status === 'running') {
                cancelTask(state.graph, node.id);
            }
        }
        state.graph.status = 'cancelled';
        state.graph.completedAt = Date.now();
    }

    // Abort any running workers
    orchestratorManager.getAbortController(graphId)?.abort();

    orchestratorManager.updateGraph(state.graph);
    return taskId
        ? `Task ${taskId} cancelled in orchestration ${graphId}.`
        : `Orchestration ${graphId} cancelled.`;
}

function stringify(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function formatGraphStatus(graph: TaskGraph): string {
    const nodes = Object.values(graph.nodes);
    const completed = nodes.filter((n) => n.status === 'completed').length;
    const duration = graph.completedAt
        ? `${((graph.completedAt - graph.createdAt) / 1000).toFixed(1)}s`
        : `${((Date.now() - graph.createdAt) / 1000).toFixed(1)}s (running)`;

    const taskLines = nodes.map((n) => {
        const symbol =
            n.status === 'completed'
                ? '✓'
                : n.status === 'failed'
                  ? '✗'
                  : n.status === 'cancelled'
                    ? '⊘'
                    : n.status === 'running'
                      ? '◉'
                      : '○';
        const errSuffix = n.error ? ` — ${n.error}` : '';
        return `  ${symbol} [${n.id}] ${n.type}: ${n.description} (${n.status})${errSuffix}`;
    });

    return `Graph: ${graph.name} (${graph.id})
Status: ${graph.status} — ${completed}/${nodes.length} complete — ${duration}
Tasks:
${taskLines.join('\n')}`;
}
