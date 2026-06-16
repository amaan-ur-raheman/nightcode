import { Mode, type ModeType } from '@nightcode/shared';
import { batchManager } from './batch-manager';
import { toolAnalytics } from './tool-analytics';
import { runWithToolExecutionPolicy } from './tool-execution-policy';
import { autoFixPipeline } from './auto-fix-pipeline';
import { fileWatcher } from './file-watcher';
import { resolve } from 'path';
import { toolOutputCache } from './tool-output-cache';
import { debug } from './debug';

const PLAN_TOOLS = new Set([
    'readFile',
    'listDirectory',
    'glob',
    'grep',
    'tree',
    'fileInfo',
    'gitStatus',
    'gitDiff',
    'webFetch',
    'codeSearch',
    'getOutline',
    'diffFiles',
    'spawnAgent',
    'spawnResearcher',
    'gitLog',
    'gitBlame',
    'gitStatusExtended',
    'tokenCount',
    'memorySet',
    'memoryGet',
    'memoryDelete',
    'memoryList',
    'memorySearch',
    'memoryFuzzySearch',
    'memoryStats',
    'keychainSet',
    'keychainGet',
    'keychainDelete',
    'getTaskStatus',
    'cancelTask',
    'orchestrator', // Tool checks BUILD mode internally and throws with a descriptive error
    'askQuestion',
    'useSkill',
    'listSkills',
    'buildKnowledgeGraph',
    'queryKnowledgeGraph',
    'getKnowledgeNeighbors',
    'addKnowledgeNode',
    'addKnowledgeEdge',
    'detectKnowledgeCycles',
    'getKnowledgeStats',
    'impactAnalysis',
    'breakingChangeCheck',
    'suggestMigration',
    'checkExternalChanges',
    'reviewPr',
    'semanticSearch',
    'profileCode',
    'suggestTool',
    'listToolCategories',
    'declareConfidence',
]);

/**
 * Tools that modify files on disk. After successful execution, we record the
 * modified file path in the auto-fix pipeline for deferred validation.
 */
const FILE_MODIFYING_TOOLS = new Set([
    'writeFile',
    'editFile',
    'patch',
    'deleteFile',
    'moveFile',
]);

/**
 * Advisory validation for destructive operations.
 * Logs warnings for high-risk operations without blocking execution.
 */
const DESTRUCTIVE_OPERATIONS: Record<
    string,
    (input: unknown) => string | null
> = {
    deleteFile: (input) => {
        const path = (input as any)?.path ?? (input as any)?.filePath;
        return path ? `Deleting file: ${path}` : 'Deleting a file';
    },
    moveFile: (input) => {
        const from = (input as any)?.from ?? (input as any)?.source;
        const to = (input as any)?.to ?? (input as any)?.destination;
        return `Moving file: ${from} → ${to}`;
    },
    gitCommit: (input) => {
        const msg =
            (input as any)?.message ??
            (input as any)?.commitMessage ??
            (input as any)?.msg;
        return msg
            ? `Committing: "${String(msg).slice(0, 60)}"`
            : 'Creating a git commit';
    },
    gitBranch: (input) => {
        const name =
            (input as any)?.name ??
            (input as any)?.branch ??
            (input as any)?.branchName;
        return name ? `Creating branch: ${name}` : 'Creating a git branch';
    },
    searchReplace: () =>
        'Performing search-replace (may affect multiple files)',
    renameSymbol: (input) => {
        const from = (input as any)?.oldName;
        const to = (input as any)?.newName;
        return from && to
            ? `Renaming symbol: ${from} → ${to}`
            : 'Renaming a symbol';
    },
};

function getAdvisoryWarning(toolName: string, input: unknown): string | null {
    const checker = DESTRUCTIVE_OPERATIONS[toolName];
    if (!checker) return null;
    return checker(input);
}

/**
 * Extract the modified file path from a tool's input/output.
 * Returns the resolved absolute path, or null if not determinable.
 */
function extractModifiedFilePath(
    toolName: string,
    input: unknown,
): string | null {
    const inp = input as Record<string, unknown> | undefined;

    const cwd = process.cwd();

    switch (toolName) {
        case 'writeFile':
        case 'editFile': {
            const p = typeof inp?.path === 'string' ? inp.path : null;
            return p ? resolve(cwd, p) : null;
        }
        case 'patch': {
            const file = typeof inp?.file === 'string' ? inp.file : null;
            return file ? resolve(cwd, file) : null;
        }
        case 'moveFile': {
            const to = typeof inp?.to === 'string' ? inp.to : null;
            return to ? resolve(cwd, to) : null;
        }
        case 'deleteFile': {
            const p = typeof inp?.path === 'string' ? inp.path : null;
            return p ? resolve(cwd, p) : null;
        }
        default:
            return null;
    }
}

async function directExecute(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
): Promise<unknown> {
    const startTime = Date.now();
    let success = true;

    // Check tool output cache for read-only tools
    const cachedResult = toolOutputCache.get(toolName, input);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    // Advisory validation: log warnings for destructive operations
    const advisory = getAdvisoryWarning(toolName, input);
    if (advisory) {
        console.warn(`[advisory] ${advisory}`);
    }

    try {
        let result: unknown;
        if (toolName.startsWith('mcp__')) {
            const { callMcpTool } = await import('./mcp-client');
            result = await runWithToolExecutionPolicy(
                toolName,
                input,
                signal,
                (toolSignal) => callMcpTool(toolName, input, toolSignal),
                parentModel,
            );
        } else {
            const { loadTool } = await import('./tools/index');
            const tool = await loadTool(toolName);
            result = await runWithToolExecutionPolicy(
                toolName,
                input,
                signal,
                (toolSignal) => tool(input, mode, parentModel, toolSignal, execId),
                parentModel,
            );
        }

        // Cache the result for future identical calls
        toolOutputCache.set(toolName, input, result);

        // Auto-advance task list if applicable
        try {
            const { getTaskList, taskListTool } =
                await import('./tools/task-list');
            const { basename } = await import('path');
            const state = getTaskList();
            if (state && state.tasks && state.tasks.length > 0) {
                const pendingOrInProgress = state.tasks.filter(
                    (t) => t.status === 'pending' || t.status === 'in-progress',
                );
                if (pendingOrInProgress.length > 0) {
                    let matchedTask: any = null;
                    const inp = input as Record<string, unknown> | undefined;

                    if (
                        [
                            'editFile',
                            'writeFile',
                            'patch',
                            'searchReplace',
                        ].includes(toolName) &&
                        inp
                    ) {
                        let filePath = '';
                        if (
                            toolName === 'editFile' ||
                            toolName === 'writeFile'
                        ) {
                            filePath =
                                typeof inp.path === 'string' ? inp.path : '';
                        } else if (toolName === 'searchReplace') {
                            filePath =
                                typeof inp.glob === 'string' ? inp.glob : '';
                        } else if (toolName === 'patch') {
                            const patchStr =
                                typeof inp.patch === 'string' ? inp.patch : '';
                            const match = /^\+\+\+\s+b\/([^\t\r\n]+)/m.exec(
                                patchStr,
                            );
                            filePath = match ? match[1]!.trim() : '';
                        }

                        if (filePath) {
                            const name = basename(filePath);
                            matchedTask = pendingOrInProgress.find((t) =>
                                t.description
                                    .toLowerCase()
                                    .includes(name.toLowerCase()),
                            );
                        }
                    } else if (toolName === 'validateCode') {
                        matchedTask = pendingOrInProgress.find((t) => {
                            const desc = t.description.toLowerCase();
                            return (
                                desc.includes('test') ||
                                desc.includes('verify') ||
                                desc.includes('typecheck') ||
                                desc.includes('validate') ||
                                desc.includes('lint') ||
                                desc.includes('check')
                            );
                        });
                    } else if (toolName === 'gitCommit') {
                        matchedTask = pendingOrInProgress.find((t) => {
                            const desc = t.description.toLowerCase();
                            return (
                                desc.includes('commit') ||
                                desc.includes('push') ||
                                desc.includes('git')
                            );
                        });
                    } else if (
                        toolName === 'bash' &&
                        inp &&
                        typeof inp.command === 'string'
                    ) {
                        const cmd = inp.command.toLowerCase();
                        if (
                            cmd.includes('test') ||
                            cmd.includes('vitest') ||
                            cmd.includes('jest')
                        ) {
                            matchedTask = pendingOrInProgress.find((t) => {
                                const desc = t.description.toLowerCase();
                                return (
                                    desc.includes('test') ||
                                    desc.includes('verify') ||
                                    desc.includes('run')
                                );
                            });
                        }
                    }

                    if (matchedTask) {
                        if (
                            typeof matchedTask.id !== 'string' ||
                            !matchedTask.id
                        ) {
                            console.warn(
                                '[local-tools] Matched task is missing a valid id property:',
                                matchedTask,
                            );
                        } else {
                            await taskListTool({
                                action: 'complete',
                                taskId: matchedTask.id,
                            });
                        }
                    }
                }
            }
        } catch (error) {
            debug.warn(
                'local-tools',
                'Failed to auto-advance task list',
                error,
            );
        }

        // Track file modifications for the auto-fix pipeline and invalidate cache
        if (FILE_MODIFYING_TOOLS.has(toolName)) {
            const filePath = extractModifiedFilePath(toolName, input);
            if (filePath) {
                autoFixPipeline.recordModification(filePath);
                fileWatcher.recordInternalChange(filePath);
            }
            toolOutputCache.clear();
        } else if (
            toolName === 'bash' ||
            toolName === 'gitCommit' ||
            toolName === 'gitBranch'
        ) {
            toolOutputCache.clear();
        }

        return result;
    } catch (error) {
        success = false;
        throw error;
    } finally {
        const duration = Date.now() - startTime;
        toolAnalytics
            .recordToolCall(toolName, duration, success)
            .catch(() => {});
    }
}

export async function executeLocalTool(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    if (mode === Mode.PLAN && !toolName.startsWith('mcp__') && !PLAN_TOOLS.has(toolName)) {
        throw new Error(`Tool ${toolName} is not available in PLAN mode`);
    }

    return batchManager.addRequest(
        toolName,
        input,
        directExecute,
        mode,
        parentModel,
        signal,
        execId,
    );
}
