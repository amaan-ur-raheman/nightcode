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

const SHORT_TOOLS = new Set([
    'readFile',
    'listDirectory',
    'glob',
    'grep',
    'tree',
    'fileInfo',
    'gitStatus',
    'gitDiff',
    'gitLog',
    'gitBlame',
    'gitStatusExtended',
    'codeSearch',
    'getOutline',
    'diffFiles',
    'tokenCount',
    'memoryGet',
    'memoryList',
    'memorySearch',
    'memoryFuzzySearch',
    'memoryStats',
    'keychainGet',
    'getTaskStatus',
    'getKnowledgeNeighbors',
    'queryKnowledgeGraph',
    'detectKnowledgeCycles',
    'getKnowledgeStats',
    'impactAnalysis',
    'breakingChangeCheck',
    'suggestMigration',
    'checkExternalChanges',
    'semanticSearch',
    'profileCode',
]);

const MUTATION_TOOLS = new Set([
    'writeFile',
    'editFile',
    'patch',
    'searchReplace',
    'deleteFile',
    'moveFile',
    'createDirectory',
    'gitCommit',
    'gitBranch',
    'renameSymbol',
    'memorySet',
    'memoryDelete',
    'keychainSet',
    'keychainDelete',
    'envManage',
    'secretScan',
    'cancelTask',
    'buildKnowledgeGraph',
    'addKnowledgeNode',
    'addKnowledgeEdge',
]);

const LONG_RUNNING_TOOLS = new Set([
    'spawnAgent',
    'spawnCodeReviewer',
    'spawnTestWriter',
    'spawnDebugger',
    'spawnRefactor',
    'spawnResearcher',
    'orchestrator',
    'validateCode',
    'reviewPr',
]);

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

    if (toolName === 'bash') {
        return {
            timeoutMs:
                applyMultiplier(
                    getNumericInputField(input, 'timeout') ?? 30_000,
                ) + COMMAND_TIMEOUT_GRACE_MS,
            longRunning: true,
        };
    }

    if (toolName === 'replExecute') {
        return {
            timeoutMs: applyMultiplier(LONG_RUNNING_TIMEOUT_MS),
            longRunning: true,
        };
    }

    if (LONG_RUNNING_TOOLS.has(toolName)) {
        return {
            timeoutMs: applyMultiplier(LONG_RUNNING_TIMEOUT_MS),
            longRunning: true,
        };
    }

    if (SHORT_TOOLS.has(toolName)) {
        return {
            timeoutMs: applyMultiplier(SHORT_TIMEOUT_MS),
            longRunning: false,
        };
    }

    if (MUTATION_TOOLS.has(toolName)) {
        return {
            timeoutMs: applyMultiplier(MUTATION_TIMEOUT_MS),
            longRunning: false,
        };
    }

    if (toolName === 'webFetch') {
        return {
            timeoutMs: applyMultiplier(MUTATION_TIMEOUT_MS),
            longRunning: false,
        };
    }

    if (toolName === 'processManage') {
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
