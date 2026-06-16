/**
 * Orchestrator Intelligence
 *
 * Enhances task graph execution with:
 * - Dynamic task decomposition (split overly complex tasks)
 * - Resource-aware scheduling (adjust concurrency by model cost)
 * - Task priority scoring (critical path + dependency depth)
 * - Adaptive retry strategies (per-task-type retry policies)
 */

import type { TaskNode, TaskGraph, AgentRole } from '@nightcode/shared';

// ── Task Complexity Scoring ──

/**
 * Estimate task complexity based on description, file count, and dependencies.
 * Returns a score from 1 (simple) to 10 (very complex).
 */
export function estimateTaskComplexity(task: TaskNode): number {
    let score = 1;

    // File count contribution
    score += Math.min(task.files.length, 5);

    // Description length/complexity
    const descWords = task.description.split(/\s+/).length;
    if (descWords > 50) score += 3;
    else if (descWords > 20) score += 2;
    else if (descWords > 10) score += 1;

    // Dependency count contribution
    score += Math.min(task.dependencies.length, 3);

    // Role-specific adjustments
    if (task.type === 'coder' || task.type === 'tester') {
        score += 1; // Code tasks tend to be more complex
    }

    return Math.min(score, 10);
}

/**
 * Check if a task should be decomposed into subtasks.
 * Returns true if complexity exceeds the threshold.
 */
export function shouldDecompose(task: TaskNode): boolean {
    const complexity = estimateTaskComplexity(task);
    return complexity > 7;
}

// ── Task Priority Scoring ──

/**
 * Calculate priority score for a task in a graph.
 * Higher score = should be scheduled first.
 *
 * Factors:
 * - Critical path membership (highest weight)
 * - Number of downstream dependents
 * - Task complexity (prefer completing complex tasks early)
 * - Role priority (code before test before review)
 */
export function calculateTaskPriority(
    task: TaskNode,
    graph: TaskGraph,
    criticalPath: string[],
): number {
    let score = 0;

    // Critical path membership (highest weight)
    if (criticalPath.includes(task.id)) {
        const cpIndex = criticalPath.indexOf(task.id);
        // Earlier in critical path = higher priority
        score += 100 * (1 - cpIndex / criticalPath.length);
    }

    // Downstream dependency count
    const downstream = countDownstream(task.id, graph);
    score += downstream * 10;

    // Task complexity (prefer doing complex tasks early when context is fresh)
    score += estimateTaskComplexity(task);

    // Role priority multiplier
    const rolePriority: Record<AgentRole, number> = {
        coder: 3,
        debugger: 3,
        tester: 2,
        reviewer: 1,
        researcher: 1,
        orchestrator: 0,
    };
    score += (rolePriority[task.type] ?? 0) * 5;

    return score;
}

/**
 * Count how many tasks depend on the given task (directly or transitively).
 */
function countDownstream(taskId: string, graph: TaskGraph): number {
    const visited = new Set<string>();
    const queue = [taskId];

    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const node of Object.values(graph.nodes)) {
            if (node.dependencies.includes(current) && !visited.has(node.id)) {
                visited.add(node.id);
                queue.push(node.id);
            }
        }
    }

    return visited.size;
}

// ── Resource-Aware Concurrency ──

/**
 * Model cost tiers for resource-aware scheduling.
 * Higher cost = lower concurrency to avoid burning credits.
 */
const MODEL_COST_TIER: Record<string, number> = {
    // Free / cheap models
    opencode: 1,
    nvidia: 1,
    groq: 1,
    // Mid-tier
    'gpt-4o-mini': 2,
    'claude-3-5-haiku': 2,
    // Expensive models
    'gpt-4o': 3,
    'claude-3-5-sonnet': 3,
    'claude-sonnet-4': 3,
    'gpt-4.5-preview': 3,
    // Very expensive
    'claude-3-opus': 4,
    o3: 4,
    'o3-mini': 4,
};

/**
 * Get recommended max concurrency for a given model.
 * Expensive models get lower concurrency to control costs.
 */
export function getRecommendedConcurrency(model: string): number {
    const tier = getModelCostTier(model);
    // Tier 1 (cheap) = 8, Tier 2 = 5, Tier 3 = 3, Tier 4 = 2
    return Math.max(2, 10 - tier * 2);
}

/**
 * Get the cost tier for a model (1 = cheapest, 4 = most expensive).
 */
export function getModelCostTier(model: string): number {
    // Direct match
    if (MODEL_COST_TIER[model]) return MODEL_COST_TIER[model]!;

    // Partial match (e.g., "openai/gpt-4o" matches "gpt-4o")
    for (const [key, tier] of Object.entries(MODEL_COST_TIER)) {
        if (model.includes(key)) return tier;
    }

    return 2; // Default to mid-tier
}

// ── Adaptive Retry Strategies ──

export interface RetryStrategy {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

/**
 * Get retry strategy based on task type and error type.
 */
export function getRetryStrategy(
    taskType: AgentRole,
    errorType?: string,
): RetryStrategy {
    // Base strategy per role
    const base: RetryStrategy = {
        coder: {
            maxRetries: 3,
            baseDelayMs: 1000,
            maxDelayMs: 10000,
            backoffMultiplier: 2,
        },
        debugger: {
            maxRetries: 2,
            baseDelayMs: 2000,
            maxDelayMs: 15000,
            backoffMultiplier: 2,
        },
        tester: {
            maxRetries: 3,
            baseDelayMs: 1000,
            maxDelayMs: 8000,
            backoffMultiplier: 2,
        },
        reviewer: {
            maxRetries: 1,
            baseDelayMs: 1000,
            maxDelayMs: 5000,
            backoffMultiplier: 1.5,
        },
        researcher: {
            maxRetries: 2,
            baseDelayMs: 1000,
            maxDelayMs: 8000,
            backoffMultiplier: 2,
        },
        orchestrator: {
            maxRetries: 1,
            baseDelayMs: 2000,
            maxDelayMs: 10000,
            backoffMultiplier: 2,
        },
    }[taskType] ?? {
        maxRetries: 2,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
    };

    // Adjust based on error type
    if (errorType === 'rate_limit') {
        return {
            ...base,
            maxRetries: Math.min(base.maxRetries + 2, 6),
            baseDelayMs: base.baseDelayMs * 3,
            maxDelayMs: 30_000,
        };
    }
    if (errorType === 'timeout') {
        return {
            ...base,
            maxRetries: Math.min(base.maxRetries + 1, 4),
            baseDelayMs: base.baseDelayMs * 2,
        };
    }
    if (errorType === 'auth') {
        return { ...base, maxRetries: 0 }; // Don't retry auth errors
    }

    return base;
}

// ── Task Decomposition Hints ──

/**
 * Analyze a task and suggest decomposition if it's too complex.
 * Returns null if decomposition is not needed, or a list of subtask descriptions.
 */
export function suggestDecomposition(task: TaskNode): string[] | null {
    if (!shouldDecompose(task)) return null;

    const suggestions: string[] = [];
    const desc = task.description;

    // Heuristic: if the description mentions multiple distinct actions, suggest splitting
    const actionVerbs = [
        'implement',
        'create',
        'add',
        'write',
        'build',
        'refactor',
        'fix',
        'update',
        'modify',
        'delete',
        'remove',
        'move',
    ];

    const foundActions = actionVerbs.filter((v) =>
        desc.toLowerCase().includes(v),
    );

    if (foundActions.length >= 3) {
        // Suggest splitting by action type
        suggestions.push(
            `Consider splitting into: ${foundActions.slice(0, 3).join(', ')}`,
        );
    }

    // If many files are involved, suggest splitting by file/module
    if (task.files.length > 5) {
        const modules = [
            ...new Set(task.files.map((f) => f.split('/').slice(-2).join('/'))),
        ];
        if (modules.length > 1) {
            suggestions.push(
                `Split by module: ${modules.slice(0, 3).join(', ')}`,
            );
        }
    }

    return suggestions.length > 0 ? suggestions : null;
}

// ── Graph Analysis ──

/**
 * Analyze a task graph and return insights for the orchestrator.
 */
export interface GraphInsights {
    /** Tasks on the critical path. */
    criticalPath: string[];
    /** Estimated total complexity. */
    totalComplexity: number;
    /** Suggested max concurrency based on models used. */
    suggestedConcurrency: number;
    /** Tasks that might benefit from decomposition. */
    decomposableTasks: string[];
    /** Bottleneck tasks (many downstream dependents). */
    bottlenecks: Array<{ taskId: string; downstream: number }>;
}

export function analyzeGraph(graph: TaskGraph): GraphInsights {
    const tasks = Object.values(graph.nodes);
    const criticalPath: string[] = []; // Would need full critical path algo
    let totalComplexity = 0;
    const decomposableTasks: string[] = [];
    const bottlenecks: Array<{ taskId: string; downstream: number }> = [];

    // Determine max concurrency from models used
    const models = new Set(tasks.map((t) => t.model).filter(Boolean));
    let suggestedConcurrency = 5; // default
    for (const model of models) {
        const rec = getRecommendedConcurrency(model!);
        suggestedConcurrency = Math.min(suggestedConcurrency, rec);
    }

    for (const task of tasks) {
        const complexity = estimateTaskComplexity(task);
        totalComplexity += complexity;

        if (shouldDecompose(task)) {
            decomposableTasks.push(task.id);
        }

        const downstream = countDownstream(task.id, graph);
        if (downstream > 2) {
            bottlenecks.push({ taskId: task.id, downstream });
        }
    }

    bottlenecks.sort((a, b) => b.downstream - a.downstream);

    return {
        criticalPath,
        totalComplexity,
        suggestedConcurrency,
        decomposableTasks,
        bottlenecks: bottlenecks.slice(0, 5),
    };
}
