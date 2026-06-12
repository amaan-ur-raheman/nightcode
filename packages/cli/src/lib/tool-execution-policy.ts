export interface ToolExecutionPolicy {
    timeoutMs: number;
    longRunning: boolean;
}

const SHORT_TIMEOUT_MS = 20_000;
const STANDARD_TIMEOUT_MS = 60_000;
const MUTATION_TIMEOUT_MS = 45_000;
const COMMAND_TIMEOUT_GRACE_MS = 2_000;
const LONG_RUNNING_TIMEOUT_MS = 10 * 60_000;

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
    'keychainGet',
    'getTaskStatus',
]);

const MUTATION_TOOLS = new Set([
    'writeFile',
    'editFile',
    'patch',
    'searchReplace',
    'deleteFile',
    'moveFile',
    'createDirectory',
    'createFile',
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
]);

const LONG_RUNNING_TOOLS = new Set([
    'spawnAgent',
    'spawnCodeReviewer',
    'spawnTestWriter',
    'spawnDebugger',
    'spawnRefactor',
    'spawnResearcher',
    'orchestrator',
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
): ToolExecutionPolicy {
    if (toolName === 'bash') {
        return {
            timeoutMs:
                (getNumericInputField(input, 'timeout') ?? 30_000) +
                COMMAND_TIMEOUT_GRACE_MS,
            longRunning: true,
        };
    }

    if (toolName === 'runTests') {
        return {
            timeoutMs:
                (getNumericInputField(input, 'timeout') ?? 60_000) +
                COMMAND_TIMEOUT_GRACE_MS,
            longRunning: true,
        };
    }

    if (LONG_RUNNING_TOOLS.has(toolName)) {
        return { timeoutMs: LONG_RUNNING_TIMEOUT_MS, longRunning: true };
    }

    if (SHORT_TOOLS.has(toolName)) {
        return { timeoutMs: SHORT_TIMEOUT_MS, longRunning: false };
    }

    if (MUTATION_TOOLS.has(toolName)) {
        return { timeoutMs: MUTATION_TIMEOUT_MS, longRunning: false };
    }

    if (toolName === 'webFetch' || toolName === 'httpRequest') {
        return { timeoutMs: MUTATION_TIMEOUT_MS, longRunning: false };
    }

    if (toolName === 'processManage') {
        return { timeoutMs: SHORT_TIMEOUT_MS, longRunning: false };
    }

    return { timeoutMs: STANDARD_TIMEOUT_MS, longRunning: false };
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
): Promise<T> {
    const policy = getToolExecutionPolicy(toolName, input);
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
