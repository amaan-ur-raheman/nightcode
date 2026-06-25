export interface ToolExecutionPolicy {
    timeoutMs: number;
    longRunning: boolean;
}

const SHORT_TIMEOUT_MS = 20_000;
const STANDARD_TIMEOUT_MS = 60_000;
const MUTATION_TIMEOUT_MS = 45_000;
const COMMAND_TIMEOUT_GRACE_MS = 2_000;
const LONG_RUNNING_TIMEOUT_MS = 10 * 60_000;

// ── Model-Aware Timeout Multipliers ──
// Slower reasoning models get more time; faster models get standard time.
const MODEL_TIMEOUT_MULTIPLIERS: Record<string, number> = {
    // Slow reasoning models — 1.5x
    'claude-opus-4': 1.5,
    'claude-3-opus': 1.5,
    'gpt-4.5-preview': 1.5,
    o1: 1.5,
    o3: 1.5,
    'o4-mini': 1.5,
    // Standard models — 1.25x
    'claude-sonnet-4': 1.25,
    'gpt-4o': 1.25,
    'gpt-4-turbo': 1.25,
    // Fast models — 1.0x (no multiplier)
    'gemini-2.0-flash': 1.0,
    'gemini-2.5-flash': 1.0,
    'gpt-4o-mini': 1.0,
    'claude-3.5-haiku': 1.0,
    'claude-3-haiku': 1.0,
};
const DEFAULT_MODEL_MULTIPLIER = 1.0; // No change by default for backward compatibility

const MODEL_TIMEOUT_CAP = 2.25; // Never exceed 2.25x base timeout

/**
 * Get the timeout multiplier for a given model ID.
 * Uses prefix matching so "openai/gpt-4o" matches "gpt-4o".
 */
export function getModelTimeoutMultiplier(modelId?: string): number {
    if (!modelId) return DEFAULT_MODEL_MULTIPLIER;
    const normalized = modelId.toLowerCase();
    // Try exact match first
    if (normalized in MODEL_TIMEOUT_MULTIPLIERS) {
        return MODEL_TIMEOUT_MULTIPLIERS[normalized]!;
    }
    // Try suffix match (e.g., "openai/gpt-4o" → "gpt-4o")
    for (const [key, mult] of Object.entries(MODEL_TIMEOUT_MULTIPLIERS)) {
        if (normalized.endsWith(key)) {
            return mult;
        }
    }
    return DEFAULT_MODEL_MULTIPLIER;
}

// ── Consolidated Tool Timeout Classification ──
// Tools use snake_case names with action-based dispatch.

/** Tools that are always short (read-only, fast). */
const SHORT_TOOLS = new Set([
    'read_file',
    'list_dir',
    'code_search',
    'workspace_memory',
    'manage_keychain',
    'knowledge_graph',
    'ask_question',
    'use_skill',
]);

/** Tools that are always mutations (write operations). */
const MUTATION_TOOLS = new Set(['write_file', 'edit_file']);

/** Tools that are always long-running. */
const LONG_RUNNING_TOOLS = new Set(['spawn_agent', 'reviewPr', 'review_pr']);

/**
 * Actions within consolidated tools that have specific timeout categories.
 * Checked only when the base tool name doesn't determine the category.
 */
const SHORT_ACTIONS: Record<string, Set<string>> = {
    git_operation: new Set([
        'status',
        'diff',
        'log',
        'blame',
        'status_extended',
        'check_external_changes',
    ]),
    run_command: new Set(['token_count']),
    workspace_memory: new Set([
        'get',
        'list',
        'search',
        'fuzzy_search',
        'stats',
    ]),
    manage_keychain: new Set(['get']),
    knowledge_graph: new Set([
        'query',
        'neighbors',
        'detect_cycles',
        'stats',
        'impact',
        'breaking_check',
        'suggest_migration',
    ]),
    orchestrate_task: new Set(['status']),
};

const MUTATION_ACTIONS: Record<string, Set<string>> = {
    git_operation: new Set(['commit', 'branch']),
    run_command: new Set(['validate_code', 'profile_code', 'env']),
    workspace_memory: new Set(['set', 'delete']),
    manage_keychain: new Set(['set', 'delete']),
    knowledge_graph: new Set(['build', 'add_node', 'add_edge']),
    edit_file: new Set([
        'edit',
        'patch',
        'search_replace',
        'delete',
        'move',
        'undo',
    ]),
};

const LONG_RUNNING_ACTIONS: Record<string, Set<string>> = {
    run_command: new Set(['bash', 'repl', 'process', 'code_analysis']),
    orchestrate_task: new Set(['run']),
};

function getNumericInputField(
    input: unknown,
    field: string,
): number | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const value = (input as Record<string, unknown>)[field];
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : undefined;
}

export function getToolExecutionPolicy(
    toolName: string,
    input?: unknown,
    modelId?: string,
): ToolExecutionPolicy {
    const multiplier = Math.min(
        getModelTimeoutMultiplier(modelId),
        MODEL_TIMEOUT_CAP,
    );

    const applyMultiplier = (base: number) => Math.round(base * multiplier);

    const action =
        input && typeof input === 'object'
            ? (input as Record<string, unknown>).action
            : undefined;
    const actionStr = typeof action === 'string' ? action : undefined;

    // ── run_command: action-specific dispatch ──
    if (toolName === 'run_command') {
        if (actionStr === 'bash') {
            return {
                timeoutMs:
                    applyMultiplier(
                        getNumericInputField(input, 'timeout') ?? 30_000,
                    ) + COMMAND_TIMEOUT_GRACE_MS,
                longRunning: true,
            };
        }
        if (LONG_RUNNING_ACTIONS.run_command?.has(actionStr ?? '')) {
            return {
                timeoutMs: applyMultiplier(LONG_RUNNING_TIMEOUT_MS),
                longRunning: true,
            };
        }
        if (MUTATION_ACTIONS.run_command?.has(actionStr ?? '')) {
            return {
                timeoutMs: applyMultiplier(MUTATION_TIMEOUT_MS),
                longRunning: false,
            };
        }
        if (SHORT_ACTIONS.run_command?.has(actionStr ?? '')) {
            return {
                timeoutMs: applyMultiplier(SHORT_TIMEOUT_MS),
                longRunning: false,
            };
        }
        return {
            timeoutMs: applyMultiplier(STANDARD_TIMEOUT_MS),
            longRunning: false,
        };
    }

    // ── Tools that are always long-running ──
    if (LONG_RUNNING_TOOLS.has(toolName)) {
        return {
            timeoutMs: applyMultiplier(LONG_RUNNING_TIMEOUT_MS),
            longRunning: true,
        };
    }

    // ── Action-aware dispatch for multi-action tools ──
    if (actionStr) {
        if (SHORT_ACTIONS[toolName]?.has(actionStr)) {
            return {
                timeoutMs: applyMultiplier(SHORT_TIMEOUT_MS),
                longRunning: false,
            };
        }
        if (MUTATION_ACTIONS[toolName]?.has(actionStr)) {
            return {
                timeoutMs: applyMultiplier(MUTATION_TIMEOUT_MS),
                longRunning: false,
            };
        }
        if (LONG_RUNNING_ACTIONS[toolName]?.has(actionStr)) {
            return {
                timeoutMs: applyMultiplier(LONG_RUNNING_TIMEOUT_MS),
                longRunning: true,
            };
        }
    }

    // ── Always-short tools (read-only, no actions or unlisted action) ──
    if (SHORT_TOOLS.has(toolName)) {
        return {
            timeoutMs: applyMultiplier(SHORT_TIMEOUT_MS),
            longRunning: false,
        };
    }

    // ── Always-mutation tools ──
    if (MUTATION_TOOLS.has(toolName)) {
        return {
            timeoutMs: applyMultiplier(MUTATION_TIMEOUT_MS),
            longRunning: false,
        };
    }

    return {
        timeoutMs: applyMultiplier(STANDARD_TIMEOUT_MS),
        longRunning: false,
    };
}

export class ToolExecutionTimeoutError extends Error {
    constructor(toolName: string, timeoutMs: number) {
        super(`Tool ${toolName} timed out after ${timeoutMs}ms`);
        this.name = 'ToolExecutionTimeoutError';
    }
}

export function createAbortError(toolName: string): Error {
    const error = new Error(`Tool ${toolName} was aborted`);
    error.name = 'AbortError';
    return error;
}

export async function runWithToolExecutionPolicy<T>(
    toolName: string,
    input: unknown,
    parentSignal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
    modelId?: string,
): Promise<T> {
    const policy = getToolExecutionPolicy(toolName, input, modelId);
    const controller = new AbortController();
    let settledByTimeout = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cleanupAbort: (() => void) | undefined;

    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal) {
        if (parentSignal.aborted) {
            controller.abort(parentSignal.reason);
        } else {
            parentSignal.addEventListener('abort', abortFromParent, {
                once: true,
            });
            cleanupAbort = () =>
                parentSignal.removeEventListener('abort', abortFromParent);
        }
    }

    try {
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                settledByTimeout = true;
                controller.abort(
                    new ToolExecutionTimeoutError(toolName, policy.timeoutMs),
                );
                reject(
                    new ToolExecutionTimeoutError(toolName, policy.timeoutMs),
                );
            }, policy.timeoutMs);
        });

        const abortPromise = new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
                'abort',
                () => {
                    if (!settledByTimeout) {
                        reject(createAbortError(toolName));
                    }
                },
                { once: true },
            );
        });

        return await Promise.race([
            run(controller.signal),
            timeoutPromise,
            abortPromise,
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
        cleanupAbort?.();
    }
}
