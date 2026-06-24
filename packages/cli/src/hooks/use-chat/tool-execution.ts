import { useRef, useCallback } from 'react';
import { type ModeType, type SupportedChatModelId } from '@nightcode/shared';
import { executeLocalTool } from '@/lib/local-tools';
import {
    callMcpTool,
    getServerForTool,
    reconnectServer,
} from '@/lib/mcp-client';
import { auditLog } from '@/lib/audit-log';
import { debug } from '@/lib/debug';
import { batchManager } from '@/lib/batch-manager';
import { ConfirmationManager } from '@/lib/tools/dangerous-ops';
import {
    setCurrentToolCallContext,
    getCurrentToolCallContext,
    setExecutionContext,
} from '@/lib/subagent-progress';
import { safeStringify } from '@/lib/safe-json';
import { confirmToolIfNeeded } from './confirm-tool';
import type { Message, PendingToolCall, ChatTools } from './types';

const MAX_SPAWNS_PER_RESPONSE = 5;

export interface ToolExecutionState {
    activeToolControllers: React.MutableRefObject<Map<string, AbortController>>;
    pendingToolCallsRef: React.MutableRefObject<
        Map<string, PendingToolCall & { isMcpTool: boolean }>
    >;
    pendingToolCallsTimer: React.MutableRefObject<ReturnType<
        typeof setTimeout
    > | null>;
    confirmationManagerRef: React.MutableRefObject<ConfirmationManager>;
}

export interface ToolExecutionActions {
    flushPendingToolCalls: (
        mode: ModeType,
        model: SupportedChatModelId | string | undefined,
    ) => void;
    handleToolCall: (toolCall: {
        toolName: string;
        input: unknown;
        toolCallId: string;
    }) => void;
}

/**
 * Tool execution logic for the chat hook.
 * Handles single and parallel tool execution with confirmation gates.
 */
export function useToolExecution(
    sessionId: string,
    chat: {
        addToolOutput: (...args: any[]) => void;
    },
    state: ToolExecutionState,
): ToolExecutionActions {
    const {
        activeToolControllers,
        pendingToolCallsRef,
        pendingToolCallsTimer,
        confirmationManagerRef,
    } = state;

    const reportResult = useCallback(
        (
            tc: PendingToolCall & { isMcpTool: boolean },
            output: unknown,
            startTime: number,
        ) => {
            activeToolControllers.current.delete(tc.toolCallId);
            auditLog.log({
                sessionId,
                tool: tc.toolName,
                input: tc.input,
                output: safeStringify(output),
                duration: Date.now() - startTime,
                success: true,
            });
            chat.addToolOutput({
                tool: tc.toolName as keyof ChatTools,
                toolCallId: tc.toolCallId,
                output:
                    typeof output === 'object' &&
                    output !== null &&
                    'output' in output
                        ? (output as { output: unknown }).output
                        : output,
            });
        },
        [sessionId, chat],
    );

    const reportError = useCallback(
        (
            tc: PendingToolCall & { isMcpTool: boolean },
            error: Error,
            startTime: number,
        ) => {
            activeToolControllers.current.delete(tc.toolCallId);
            if (tc.isMcpTool) {
                const serverName = getServerForTool(tc.toolName);
                if (serverName) {
                    debug.log(
                        'mcp',
                        `Tool call failed, attempting reconnect for ${serverName}`,
                    );
                    void reconnectServer(serverName);
                }
            }
            auditLog.log({
                sessionId,
                tool: tc.toolName,
                input: tc.input,
                error: error.message,
                duration: Date.now() - startTime,
                success: false,
            });
            chat.addToolOutput({
                tool: tc.toolName as keyof ChatTools,
                toolCallId: tc.toolCallId,
                state: 'output-error',
                errorText: error.message,
            });
        },
        [sessionId, chat],
    );

    const runTool = useCallback(
        async (
            tc: PendingToolCall & { isMcpTool: boolean },
            mode: ModeType,
            model: SupportedChatModelId | string | undefined,
        ) => {
            const abortController = new AbortController();
            activeToolControllers.current.set(tc.toolCallId, abortController);

            const confirmResult = await confirmToolIfNeeded(
                tc.toolName,
                tc.input,
                tc.isMcpTool,
                confirmationManagerRef.current,
            );
            if (!confirmResult.confirmed) {
                return { output: confirmResult.output };
            }

            const execId = setExecutionContext(tc.toolCallId);
            setCurrentToolCallContext(tc.toolCallId);
            try {
                return tc.isMcpTool
                    ? callMcpTool(tc.toolName, tc.input, abortController.signal)
                    : executeLocalTool(
                          tc.toolName,
                          tc.input,
                          mode,
                          model,
                          abortController.signal,
                          execId,
                      );
            } finally {
                if (getCurrentToolCallContext() === tc.toolCallId) {
                    setCurrentToolCallContext(null);
                }
            }
        },
        [activeToolControllers, confirmationManagerRef],
    );

    const flushPendingToolCalls = useCallback(
        (mode: ModeType, model: SupportedChatModelId | string | undefined) => {
            const pending = Array.from(pendingToolCallsRef.current.values());
            pendingToolCallsRef.current.clear();

            if (pending.length === 0) return;

            // Enforce per-response spawn cap
            const spawnCount = pending.filter((tc) =>
                tc.toolName.startsWith('spawn'),
            ).length;
            if (spawnCount > MAX_SPAWNS_PER_RESPONSE) {
                debug.log(
                    'chat',
                    `Capping spawns: ${spawnCount} requested, ${MAX_SPAWNS_PER_RESPONSE} allowed`,
                );
                const kept: typeof pending = [];
                const rejected: typeof pending = [];
                let spawnsKept = 0;
                for (const tc of pending) {
                    const isSpawn = tc.toolName.startsWith('spawn');
                    if (isSpawn && spawnsKept >= MAX_SPAWNS_PER_RESPONSE) {
                        rejected.push(tc);
                    } else {
                        if (isSpawn) spawnsKept++;
                        kept.push(tc);
                    }
                }
                for (const tc of rejected) {
                    chat.addToolOutput({
                        tool: tc.toolName as keyof ChatTools,
                        toolCallId: tc.toolCallId,
                        state: 'output-error',
                        errorText: `Spawn cap reached (${MAX_SPAWNS_PER_RESPONSE} per response). Too many subagents requested — batch related work into fewer, broader subagent calls instead.`,
                    });
                }
                pending.length = 0;
                pending.push(...kept);
            }

            debug.log(
                'chat',
                `Flushing ${pending.length} pending tool call(s): ${pending.map((t) => t.toolName).join(', ')}`,
            );

            // Single tool call — execute directly
            if (pending.length === 1) {
                const tc = pending[0]!;
                const startTime = Date.now();
                void runTool(tc, mode, model)
                    .then((output) => reportResult(tc, output, startTime))
                    .catch((error) =>
                        reportError(
                            tc,
                            error instanceof Error
                                ? error
                                : new Error(String(error)),
                            startTime,
                        ),
                    );
                return;
            }

            // Multiple tool calls — execute in parallel via batchManager
            if (batchManager.getConfig().parallelExecutionEnabled) {
                const startTime = Date.now();
                debug.log(
                    'chat',
                    `Parallel execution: ${pending.length} tools`,
                    {
                        tools: pending.map((t) => t.toolName),
                    },
                );

                const toolCalls = pending.map((tc) => {
                    const abortController = new AbortController();
                    activeToolControllers.current.set(
                        tc.toolCallId,
                        abortController,
                    );
                    return {
                        toolName: tc.toolName,
                        input: tc.input,
                        toolCallId: tc.toolCallId,
                        signal: abortController.signal,
                    };
                });

                const reportedIds = new Set<string>();

                void batchManager
                    .executeParallel(
                        toolCalls,
                        async (
                            toolName,
                            input,
                            execMode,
                            execModel,
                            execSignal,
                            toolCallId,
                        ) => {
                            const tc = pending.find(
                                (t) => t.toolCallId === toolCallId,
                            );
                            const isMcp =
                                tc?.isMcpTool ?? toolName.startsWith('mcp__');
                            const confirmResult = await confirmToolIfNeeded(
                                toolName,
                                input,
                                isMcp,
                                confirmationManagerRef.current,
                            );
                            if (!confirmResult.confirmed)
                                return {
                                    output: confirmResult.output,
                                };
                            const execId = tc
                                ? setExecutionContext(tc.toolCallId)
                                : undefined;
                            setCurrentToolCallContext(tc?.toolCallId ?? null);
                            try {
                                return isMcp
                                    ? callMcpTool(toolName, input, execSignal)
                                    : executeLocalTool(
                                          toolName,
                                          input,
                                          execMode,
                                          execModel,
                                          execSignal,
                                          execId,
                                      );
                            } finally {
                                if (
                                    tc &&
                                    getCurrentToolCallContext() ===
                                        tc.toolCallId
                                ) {
                                    setCurrentToolCallContext(null);
                                }
                            }
                        },
                        mode,
                        model,
                        undefined,
                        (result) => {
                            const tc = pending.find(
                                (t) => t.toolCallId === result.toolCallId,
                            );
                            if (!tc || reportedIds.has(result.toolCallId))
                                return;
                            reportedIds.add(result.toolCallId);
                            if (result.error) {
                                reportError(tc, result.error, startTime);
                            } else {
                                reportResult(tc, result.result, startTime);
                            }
                        },
                    )
                    .then((results) => {
                        const executedIds = new Set(
                            results.map((result) => result.toolCallId),
                        );
                        for (const result of results) {
                            const tc = pending.find(
                                (t) => t.toolCallId === result.toolCallId,
                            );
                            if (!tc || reportedIds.has(result.toolCallId))
                                continue;
                            reportedIds.add(result.toolCallId);
                            if (result.error) {
                                reportError(tc, result.error, startTime);
                            } else {
                                reportResult(tc, result.result, startTime);
                            }
                        }
                        for (const tc of pending) {
                            if (!executedIds.has(tc.toolCallId)) {
                                activeToolControllers.current.delete(
                                    tc.toolCallId,
                                );
                                chat.addToolOutput({
                                    tool: tc.toolName as keyof ChatTools,
                                    toolCallId: tc.toolCallId,
                                    state: 'output-error',
                                    errorText:
                                        'Tool execution skipped due to parallel limit.',
                                });
                            }
                        }
                        debug.log(
                            'chat',
                            `Parallel batch complete: ${results.length} tools in ${Date.now() - startTime}ms`,
                        );
                    })
                    .catch((error) => {
                        const err =
                            error instanceof Error
                                ? error
                                : new Error(String(error));
                        for (const tc of pending) {
                            if (!reportedIds.has(tc.toolCallId)) {
                                reportError(tc, err, startTime);
                            }
                        }
                    });
            } else {
                // Parallel disabled — execute each tool directly
                for (const tc of pending) {
                    const startTime = Date.now();
                    void runTool(tc, mode, model)
                        .then((output) => reportResult(tc, output, startTime))
                        .catch((error) =>
                            reportError(
                                tc,
                                error instanceof Error
                                    ? error
                                    : new Error(String(error)),
                                startTime,
                            ),
                        );
                }
            }
        },
        [
            sessionId,
            chat,
            pendingToolCallsRef,
            activeToolControllers,
            confirmationManagerRef,
            runTool,
            reportResult,
            reportError,
        ],
    );

    const handleToolCall = useCallback(
        (toolCall: {
            toolName: string;
            input: unknown;
            toolCallId: string;
        }) => {
            const isMcpTool = toolCall.toolName.startsWith('mcp__');

            pendingToolCallsRef.current.set(toolCall.toolCallId, {
                toolName: toolCall.toolName,
                input: toolCall.input,
                toolCallId: toolCall.toolCallId,
                isMcpTool,
            });

            if (pendingToolCallsTimer.current) {
                clearTimeout(pendingToolCallsTimer.current);
            }
            pendingToolCallsTimer.current = setTimeout(() => {
                pendingToolCallsTimer.current = null;
                // Mode and model will be determined from chat messages in the caller
            }, 50);
        },
        [pendingToolCallsRef, pendingToolCallsTimer],
    );

    return {
        flushPendingToolCalls,
        handleToolCall,
    };
}
