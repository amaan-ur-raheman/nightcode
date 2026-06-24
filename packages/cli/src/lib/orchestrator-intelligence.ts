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
import { getCriticalPath } from '@nightcode/shared';

// ── Decomposition Decision ──

export interface DecompositionDecision {
    /** Whether the task should be decomposed into subtasks */
    shouldDecompose: boolean;
    /** Human-readable reason for the decision */
    reason: string;
    /** Estimated complexity score (1-10) */
    complexity: number;
    /** Whether this is a simple task that can skip LLM decomposition */
    isSimple: boolean;
    /** Suggested role breakdown if decomposing */
    suggestedRoles?: AgentRole[];
    /** Confidence in this decision (0-1) */
    confidence: number;
}

/**
 * Analyze a raw task string and produce a structured decomposition decision.
 * This is the single entry point for deciding whether to decompose.
 */
export function analyzeDecomposition(task: string): DecompositionDecision {
    // ── Simple task fast path ──
    if (isSimpleTaskString(task)) {
        return {
            shouldDecompose: false,
            reason: 'Simple single-step task',
            complexity: 1,
            isSimple: true,
            confidence: 0.9,
        };
    }

    // ── Complexity scoring on raw text ──
    const complexity = estimateRawTaskComplexity(task);

    if (complexity <= 5) {
        return {
            shouldDecompose: false,
            reason: `Low complexity (${complexity}/10)`,
            complexity,
            isSimple: false,
            confidence: 0.8,
        };
    }

    if (complexity > 7) {
        const suggestedRoles = inferRoles(task);
        return {
            shouldDecompose: true,
            reason: `High complexity (${complexity}/10) — ${describeComplexitySignals(task)}`,
            complexity,
            isSimple: false,
            suggestedRoles,
            confidence: Math.min(0.5 + complexity * 0.05, 0.95),
        };
    }

    // Medium complexity (6-7) — decompose only if multi-concern
    const hasCombinedConcerns = detectCombinedConcerns(task);
    if (hasCombinedConcerns) {
        return {
            shouldDecompose: true,
            reason: `Medium complexity with combined concerns (${complexity}/10)`,
            complexity,
            isSimple: false,
            suggestedRoles: inferRoles(task),
            confidence: 0.7,
        };
    }

    return {
        shouldDecompose: false,
        reason: `Medium complexity, single concern (${complexity}/10)`,
        complexity,
        isSimple: false,
        confidence: 0.75,
    };
}

/**
 * Estimate complexity from a raw task string (no TaskNode needed).
 * Used by analyzeDecomposition for pre-graph decisions.
 */
function estimateRawTaskComplexity(task: string): number {
    let score = 1;

    // File count contribution
    const fileRefs = (
        task.match(
            /\.(ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)(?::\d+)?/g,
        ) ?? []
    ).length;
    score += Math.min(fileRefs, 5);

    // Description word count
    const words = task.split(/\s+/).length;
    if (words > 80) score += 4;
    else if (words > 50) score += 3;
    else if (words > 25) score += 2;
    else if (words > 12) score += 1;

    // Multi-step markers boost complexity
    if (
        /\b(and then|then |followed by|after that|additionally|meanwhile)\b/i.test(
            task,
        )
    ) {
        score += 2;
    }

    // Combined concerns (implement + test, refactor + test, etc.)
    if (detectCombinedConcerns(task)) {
        score += 2;
    }

    // Multiple distinct action verbs
    const actionVerbs = [
        'implement',
        'create',
        'build',
        'refactor',
        'fix',
        'update',
        'delete',
        'move',
        'rename',
        'add',
        'write',
        'modify',
        'test',
        'verify',
        'review',
        'debug',
    ];
    const foundVerbs = actionVerbs.filter((v) =>
        task.toLowerCase().includes(v),
    );
    if (foundVerbs.length >= 3) score += 1;
    if (foundVerbs.length >= 5) score += 1;

    return Math.min(score, 10);
}

/**
 * Detect if a task combines multiple concerns (e.g., implement + test).
 */
function detectCombinedConcerns(task: string): boolean {
    const lower = task.toLowerCase();
    const hasImplementation =
        /\b(implement|create|build|add|write|refactor|modify|change|update)\b/i.test(
            lower,
        );
    const hasTesting = /\b(test|spec|verify|validate)\b/i.test(lower);
    const hasDebug = /\b(debug|fix|bug|broken|error|issue)\b/i.test(lower);
    const hasReview = /\b(review|audit|check)\b/i.test(lower);

    return (
        (hasImplementation && hasTesting) ||
        (hasImplementation && hasReview) ||
        (hasDebug && hasTesting)
    );
}

/**
 * Infer suggested roles from task content.
 */
function inferRoles(task: string): AgentRole[] {
    const lower = task.toLowerCase();
    const roles: AgentRole[] = [];

    if (
        /\b(implement|create|build|add|write|modify|change|update|refactor)\b/i.test(
            lower,
        )
    ) {
        roles.push('coder');
    }
    if (/\b(test|spec|verify|validate)\b/i.test(lower)) {
        roles.push('tester');
    }
    if (/\b(review|audit|check|security|quality)\b/i.test(lower)) {
        roles.push('reviewer');
    }
    if (
        /\b(debug|fix|bug|broken|error|issue|investigate|root cause)\b/i.test(
            lower,
        )
    ) {
        roles.push('debugger');
    }
    if (/\b(research|analyze|understand|document|explore)\b/i.test(lower)) {
        roles.push('researcher');
    }

    return roles.length > 0 ? roles : ['coder'];
}

/**
 * Describe what makes a task complex (for the reason field).
 */
function describeComplexitySignals(task: string): string {
    const signals: string[] = [];
    const fileRefs = (
        task.match(
            /\.(ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)/g,
        ) ?? []
    ).length;
    if (fileRefs >= 3) signals.push(`${fileRefs} files`);
    const words = task.split(/\s+/).length;
    if (words > 50) signals.push(`detailed description (${words} words)`);
    if (detectCombinedConcerns(task)) signals.push('combined concerns');
    if (/\b(and then|then |followed by|after that)\b/i.test(task))
        signals.push('multi-step');
    return signals.length > 0 ? signals.join(', ') : 'high word count';
}

/**
 * Fast check if a raw task string is simple enough to skip LLM decomposition.
 * Returns true for single-step, 1-2 file tasks.
 */
function isSimpleTaskString(task: string): boolean {
    if (task.length > 200) return false;

    const srcFileRefs = (
        task.match(
            /(?:\.\/|\.\.\/|\w+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)/g,
        ) ?? []
    ).length;

    if (srcFileRefs >= 3) return false;

    const hasMultiStepMarker =
        /\b(and then|then |followed by|after that|additionally|meanwhile|subsequently|also test|and test|and verify|and validate|and review|and debug)\b/i.test(
            task,
        );
    if (hasMultiStepMarker) return false;

    const taskWithoutFileRefs = task.replace(
        /(?:\.\/|\.\.\/|\w+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)/gi,
        '',
    );

    if (detectCombinedConcerns(taskWithoutFileRefs)) return false;

    if (srcFileRefs <= 2) return true;

    const phrases = task.split(/\s*(?:and|then|also)\s+/i).filter(Boolean);
    if (phrases.length >= 2 && phrases.length <= 4 && task.length < 150)
        return true;

    if (task.length > 100) return false;

    return true;
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

// ── Task Complexity Scoring (backward-compatible, operates on TaskNode) ──

/**
 * Estimate task complexity based on description, file count, and dependencies.
 * Returns a score from 1 (simple) to 10 (very complex).
 * For raw string analysis, use analyzeDecomposition() instead.
 */
export function estimateTaskComplexity(task: TaskNode): number {
    let score = 1;
    score += Math.min(task.files.length, 5);
    const descWords = task.description.split(/\s+/).length;
    if (descWords > 50) score += 3;
    else if (descWords > 20) score += 2;
    else if (descWords > 10) score += 1;
    score += Math.min(task.dependencies.length, 3);
    if (task.type === 'coder' || task.type === 'tester') score += 1;
    return Math.min(score, 10);
}

/**
 * Check if a task should be decomposed into subtasks.
 * Returns true if complexity exceeds the threshold.
 * For richer analysis, use analyzeDecomposition() instead.
 */
export function shouldDecompose(task: TaskNode): boolean {
    return estimateTaskComplexity(task) > 7;
}

// ── Task Decomposition Hints ──

/**
 * Analyze a task and suggest decomposition if it's too complex.
 * Returns null if decomposition is not needed, or a list of subtask descriptions.
 */
export function suggestDecomposition(task: TaskNode): string[] | null {
    const decision = analyzeDecomposition(task.description);
    if (!decision.shouldDecompose) return null;

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

    // Add role-based suggestion from the decision
    if (decision.suggestedRoles && decision.suggestedRoles.length > 1) {
        suggestions.push(
            `Suggested roles: ${decision.suggestedRoles.join(', ')}`,
        );
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
    const criticalPath = getCriticalPath(graph);
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
