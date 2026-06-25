import { Mode, type ModeType } from '@nightcode/shared';
import { batchManager } from './batch-manager';
import { toolAnalytics } from './tool-analytics';
import { runWithToolExecutionPolicy } from './tool-execution-policy';
import { autoFixPipeline } from './auto-fix-pipeline';
import { fileWatcher } from './file-watcher';
import { resolve } from 'path';
import { toolOutputCache } from './tool-output-cache';
import { debug } from './debug';

// ── Post-hoc Delegation Learning ──
// Tracks tool usage patterns across a response cycle to detect when
// the main agent should have delegated to subagents/orchestrator.
// These are recorded as suggestions that feed back into the system prompt
// via the corrections-tracking mechanism.

interface ToolUsageWindow {
    toolCalls: Array<{
        toolName: string;
        timestamp: number;
        input: Record<string, unknown>;
    }>;
    firstCallTime: number;
    windowActive: boolean;
}

let toolUsageWindow: ToolUsageWindow = {
    toolCalls: [],
    firstCallTime: 0,
    windowActive: false,
};

/** Minimal suggestion threshold — we only record strong signals to avoid noise. */
const MIN_SEQUENTIAL_EDITS_FOR_DELEGATION = 5;
const MIN_FILES_MODIFIED_FOR_ORCHESTRATOR = 3;

/**
 * Start a new tool usage window. Call this at the beginning of each
 * response cycle (when the AI starts calling tools).
 */
export function startToolUsageWindow(): void {
    toolUsageWindow = {
        toolCalls: [],
        firstCallTime: Date.now(),
        windowActive: true,
    };
}

/**
 * Record a tool call in the current usage window.
 */
export function recordToolCallInWindow(toolName: string, input: unknown): void {
    if (!toolUsageWindow.windowActive) return;
    toolUsageWindow.toolCalls.push({
        toolName,
        timestamp: Date.now(),
        input: (input ?? {}) as Record<string, unknown>,
    });
}

/**
 * Analyze the current tool usage window and record learning signals
 * if the agent should have delegated but didn't. Call this at the end
 * of each response cycle.
 */
export async function analyzeToolUsageWindow(): Promise<void> {
    if (!toolUsageWindow.windowActive) return;
    toolUsageWindow.windowActive = false;

    const calls = toolUsageWindow.toolCalls;
    if (calls.length < 3) return; // Not enough data to analyze

    const { correctionTracker } = await import('./correction-tracker');

    // Count write-type tools
    const writeTools = ['write_file', 'edit_file'];
    const writeCalls = calls.filter((c) => writeTools.includes(c.toolName));
    const uniqueFiles = new Set(
        writeCalls
            .map((c) => {
                const path =
                    typeof c.input.path === 'string'
                        ? c.input.path
                        : typeof c.input.file === 'string'
                          ? c.input.file
                          : typeof c.input.glob === 'string'
                            ? c.input.glob
                            : '';
                return path;
            })
            .filter(Boolean),
    );

    const hasBashTest = calls.some((c) => {
        if (c.toolName !== 'run_command') return false;
        const cmd =
            typeof c.input.command === 'string'
                ? c.input.command.toLowerCase()
                : '';
        return (
            cmd.includes('test') ||
            cmd.includes('vitest') ||
            cmd.includes('jest')
        );
    });

    // Signal 1: Agent wrote files across 3+ files — should have used orchestrator
    if (uniqueFiles.size >= MIN_FILES_MODIFIED_FOR_ORCHESTRATOR) {
        const suggestion = `For tasks modifying ${uniqueFiles.size} files (${Array.from(uniqueFiles).slice(0, 3).join(', ')}...), use the orchestrator tool instead of making edits manually. The orchestrator parallelizes across files and reduces context loss.`;
        await correctionTracker.recordSuggestion(
            suggestion,
            'orchestrate_task',
        );
        console.log(`[delegation-learning] ${suggestion}`);
    }

    // Signal 2: Agent made many sequential edits — could have used subagent
    if (
        writeCalls.length >= MIN_SEQUENTIAL_EDITS_FOR_DELEGATION &&
        uniqueFiles.size >= 2
    ) {
        const suggestion = `Made ${writeCalls.length} edits across ${uniqueFiles.size} files in sequence. Consider delegating parts of this work to subagents (e.g. spawnRefactor for restructuring, spawnTestWriter for test files) and using the orchestrator for parallel execution.`;
        await correctionTracker.recordSuggestion(suggestion, 'spawn_agent');
        console.log(`[delegation-learning] ${suggestion}`);
    }

    // Signal 3: Agent manually wrote tests — should have used spawnTestWriter
    const manualTestCalls = writeCalls.filter((c) => {
        const path = typeof c.input.path === 'string' ? c.input.path : '';
        return path.includes('.test.') || path.includes('.spec.');
    });
    if (manualTestCalls.length >= 2) {
        const suggestion = `Wrote ${manualTestCalls.length} test files manually. Use spawnTestWriter for writing tests — it has an optimized prompt and handles the test-writing workflow more efficiently.`;
        await correctionTracker.recordSuggestion(suggestion, 'spawn_agent');
        console.log(`[delegation-learning] ${suggestion}`);
    }

    // Signal 4: Agent combined implementation + testing in same response
    const hasImplWrite = writeCalls.some((c) => {
        const path = typeof c.input.path === 'string' ? c.input.path : '';
        return !path.includes('.test.') && !path.includes('.spec.');
    });
    if (hasImplWrite && hasBashTest) {
        const suggestion = `Combined implementation and testing in one response. Use the orchestrator with parallel coder + tester roles for multi-step features that need both implementation and verification.`;
        await correctionTracker.recordSuggestion(
            suggestion,
            'orchestrate_task',
        );
        console.log(`[delegation-learning] ${suggestion}`);
    }
}

const PLAN_TOOLS = new Set([
    'read_file',
    'list_dir',
    'code_search',
    'git_operation',
    'knowledge_graph',
    'spawn_agent',
    'workspace_memory',
    'ask_question',
    'use_skill',
]);

/**
 * Tools that modify files on disk. After successful execution, we record the
 * modified file path in the auto-fix pipeline for deferred validation.
 */
const FILE_MODIFYING_TOOLS = new Set(['write_file', 'edit_file']);

/**
 * Advisory validation for destructive operations.
 * Logs warnings for high-risk operations without blocking execution.
 */
const DESTRUCTIVE_OPERATIONS: Record<
    string,
    (input: unknown) => string | null
> = {
    edit_file: (input) => {
        const action = (input as any)?.action;
        if (action === 'delete') {
            const path = (input as any)?.path;
            return path ? `Deleting file: ${path}` : 'Deleting a file';
        }
        if (action === 'move') {
            const from = (input as any)?.path;
            const to = (input as any)?.to;
            return `Moving file: ${from} → ${to}`;
        }
        if (action === 'search_replace') {
            return 'Performing search-replace (may affect multiple files)';
        }
        return null;
    },
    git_operation: (input) => {
        const action = (input as any)?.action;
        if (action === 'commit') {
            const msg = (input as any)?.message;
            return msg
                ? `Committing: "${String(msg).slice(0, 60)}"`
                : 'Creating a git commit';
        }
        if (action === 'branch') {
            const name = (input as any)?.branchName;
            return name ? `Creating branch: ${name}` : 'Creating a git branch';
        }
        return null;
    },
    code_search: (input) => {
        const action = (input as any)?.action;
        if (action === 'rename_symbol') {
            const from = (input as any)?.symbol;
            const to = (input as any)?.newName;
            return from && to
                ? `Renaming symbol: ${from} → ${to}`
                : 'Renaming a symbol';
        }
        return null;
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

    if (toolName === 'write_file') {
        const p = typeof inp?.path === 'string' ? inp.path : null;
        return p ? resolve(cwd, p) : null;
    }

    if (toolName === 'edit_file') {
        const action = inp?.action;
        if (action === 'edit' || action === 'delete') {
            const p = typeof inp?.path === 'string' ? inp.path : null;
            return p ? resolve(cwd, p) : null;
        }
        if (action === 'patch') {
            const p = typeof inp?.path === 'string' ? inp.path : null;
            if (p) return resolve(cwd, p);
            // Attempt to derive file path from patch header (+++ b/...)
            const patchStr = typeof inp?.patch === 'string' ? inp.patch : '';
            const match = /^\+\+\+\s+b\/([^\t\r\n]+)/m.exec(patchStr);
            return match ? resolve(cwd, match[1]!.trim()) : null;
        }
        if (action === 'move') {
            const to = typeof inp?.to === 'string' ? inp.to : null;
            return to ? resolve(cwd, to) : null;
        }
    }

    return null;
}

async function directExecute(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
): Promise<unknown> {
    recordToolCallInWindow(toolName, input);

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
                (toolSignal) =>
                    tool(input, mode, parentModel, toolSignal, execId),
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
                        (toolName === 'edit_file' ||
                            toolName === 'write_file') &&
                        inp
                    ) {
                        let filePath = '';
                        if (toolName === 'write_file') {
                            filePath =
                                typeof inp.path === 'string' ? inp.path : '';
                        } else if (toolName === 'edit_file') {
                            const action = inp.action;
                            if (
                                action === 'edit' ||
                                action === 'delete' ||
                                action === 'patch'
                            ) {
                                filePath =
                                    typeof inp.path === 'string'
                                        ? inp.path
                                        : '';
                                if (!filePath && action === 'patch') {
                                    const patchStr =
                                        typeof inp.patch === 'string'
                                            ? inp.patch
                                            : '';
                                    const match =
                                        /^\+\+\+\s+b\/([^\t\r\n]+)/m.exec(
                                            patchStr,
                                        );
                                    filePath = match ? match[1]!.trim() : '';
                                }
                            } else if (action === 'move') {
                                filePath =
                                    typeof inp.to === 'string' ? inp.to : '';
                            } else if (action === 'search_replace') {
                                filePath =
                                    typeof inp.glob === 'string'
                                        ? inp.glob
                                        : '';
                            }
                        }

                        if (filePath) {
                            const name = basename(filePath);
                            matchedTask = pendingOrInProgress.find((t) =>
                                t.description
                                    .toLowerCase()
                                    .includes(name.toLowerCase()),
                            );
                        }
                    } else if (
                        toolName === 'run_command' &&
                        inp &&
                        inp.action === 'validate_code'
                    ) {
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
                    } else if (
                        toolName === 'git_operation' &&
                        inp &&
                        inp.action === 'commit'
                    ) {
                        matchedTask = pendingOrInProgress.find((t) => {
                            const desc = t.description.toLowerCase();
                            return (
                                desc.includes('commit') ||
                                desc.includes('push') ||
                                desc.includes('git')
                            );
                        });
                    } else if (
                        toolName === 'run_command' &&
                        inp &&
                        inp.action === 'bash' &&
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
        } else if (toolName === 'run_command' || toolName === 'git_operation') {
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

        // Analyze tool usage window when appropriate
        // (called from use-chat.ts at response boundaries)
        // Kept here as a safety net for very long single responses (>100 calls)
        if (
            toolUsageWindow.toolCalls.length > 0 &&
            toolUsageWindow.windowActive &&
            toolUsageWindow.toolCalls.length % 100 === 0
        ) {
            analyzeToolUsageWindow().catch(() => {});
        }
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
    if (
        mode === Mode.PLAN &&
        !toolName.startsWith('mcp__') &&
        !PLAN_TOOLS.has(toolName)
    ) {
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
