import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import {
    DefaultChatTransport,
    type InferUITools,
    lastAssistantMessageIsCompleteWithToolCalls,
    type LanguageModelUsage,
    type UIMessage,
} from 'ai';

import { useChat as useAIChat } from '@ai-sdk/react';
import {
    type ModeType,
    type SupportedChatModelId,
    type ToolContracts,
    type ConversationBranch,
    DEFAULT_CHAT_MODEL_ID,
    Mode,
} from '@nightcode/shared';

import { getAuth } from '@/lib/auth';
import { apiClient } from '@/lib/api-client';
import { getApiKeyForProvider } from '@/lib/api-keys';
import { resolveProviderForModel } from '@nightcode/shared';
import { executeLocalTool } from '@/lib/local-tools';
import {
    loadMcpTools,
    callMcpTool,
    getServerForTool,
    reconnectServer,
    type McpToolSchema,
} from '@/lib/mcp-client';
import { auditLog } from '@/lib/audit-log';
import { debug } from '@/lib/debug';
import { batchManager } from '@/lib/batch-manager';
import {
    ConfirmationManager,
    getConfirmationLevel,
    formatToolInput,
    getAccessPath,
    getPatterns,
} from '@/lib/tools/dangerous-ops';
import { questionManager } from '@/lib/tools/question-manager';
import { isConfirmationEnabled } from '@/lib/settings';
import {
    setCurrentToolCallContext,
    getCurrentToolCallContext,
    setExecutionContext,
} from '@/lib/subagent-progress';
import { safeStringify } from '@/lib/safe-json';

const MAX_SUBAGENT_OUTPUT_CHARS = 8000;

/**
 * Maximum number of spawn tools (spawnAgent, spawnResearcher, etc.) that can
 * execute per AI response. Prevents runaway spawning where the AI emits
 * 80+ spawn calls in a single turn, wasting hundreds of thousands of tokens.
 * Excess spawn calls are rejected with an error.
 */
const MAX_SPAWNS_PER_RESPONSE = 5;

// Cost constants removed — pricing is derived from shared/src/credits.ts
// using SUPPORTED_CHAT_MODELS.pricing as the single source of truth

/**
 * Prune subagent tool outputs that exceed the size limit.
 * Keeps the first and last portion, replacing the middle with a truncation notice.
 */
function pruneToolOutput(output: unknown): unknown {
    if (output == null) return output;
    if (typeof output === 'object' && 'result' in output) {
        const result = (output as { result: string }).result;
        if (
            typeof result === 'string' &&
            result.length > MAX_SUBAGENT_OUTPUT_CHARS
        ) {
            const head = result.slice(0, MAX_SUBAGENT_OUTPUT_CHARS / 2);
            const tail = result.slice(-MAX_SUBAGENT_OUTPUT_CHARS / 2);
            return {
                ...output,
                result: `${head}\n\n... [truncated ${result.length - MAX_SUBAGENT_OUTPUT_CHARS} chars] ...\n\n${tail}`,
            };
        }
    }
    return output;
}

/**
 * Prune old messages to keep context size manageable.
 * For messages older than the last 10, truncate large tool outputs.
 */
function pruneOldMessages(messages: Message[]): Message[] {
    if (messages.length <= 10) return messages;
    const recentCount = 10;
    const oldMessages = messages.slice(0, messages.length - recentCount);
    const recentMessages = messages.slice(messages.length - recentCount);

    return [
        ...oldMessages.map((msg) => {
            if (msg.role !== 'assistant' || !Array.isArray(msg.parts))
                return msg;
            return {
                ...msg,
                parts: msg.parts.map((part) => {
                    if (
                        part.type === 'dynamic-tool' ||
                        (typeof part.type === 'string' &&
                            part.type.startsWith('tool-'))
                    ) {
                        const toolPart = part as any;
                        if (
                            toolPart.state === 'output-available' &&
                            toolPart.output != null
                        ) {
                            return {
                                ...toolPart,
                                output: pruneToolOutput(toolPart.output),
                            };
                        }
                    }
                    return part;
                }),
            };
        }),
        ...recentMessages,
    ];
}

export type ChatMessageMetadata = {
    mode?: ModeType;
    model?: SupportedChatModelId | string;
    durationMs?: number;
    usage?: LanguageModelUsage;
};

type ChatTools = {
    [Name in keyof InferUITools<ToolContracts>]: {
        input: InferUITools<ToolContracts>[Name]['input'];
        output: unknown;
    };
};

export type Message = UIMessage<ChatMessageMetadata, any, ChatTools>;

export type ImageAttachment = {
    dataUrl: string;
    mimeType: string;
    name: string;
};

type PendingToolCall = {
    toolName: string;
    input: unknown;
    toolCallId: string;
};

export function useChat(
    sessionId: string,
    initialMessages: Message[],
    initialImageAttachments?: ImageAttachment[],
) {
    const isInterruptedRef = useRef(false);
    const mcpToolsRef = useRef<McpToolSchema[]>([]);
    const activeToolControllers = useRef<Map<string, AbortController>>(
        new Map(),
    );
    const cumulativeUsageRef = useRef({
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
    });
    const confirmationManagerRef = useRef(new ConfirmationManager());
    const chatRef = useRef<ReturnType<typeof useAIChat<Message>> | null>(null);
    const pendingToolCallsRef = useRef<
        Map<string, PendingToolCall & { isMcpTool: boolean }>
    >(new Map());
    const pendingToolCallsTimer = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    // ─── Image attachments ─────────────────────────────────────────────────
    const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>(
        initialImageAttachments ?? [],
    );

    // ─── Branch state ──────────────────────────────────────────────────────
    const [branches, setBranches] = useState<ConversationBranch[]>([]);
    const [activeBranchId, setActiveBranchId] = useState<string>('main');
    const [branchMessages, setBranchMessages] = useState<
        Record<string, Message[]>
    >({});

    useEffect(() => {
        loadMcpTools().then((tools) => {
            mcpToolsRef.current = tools;
            debug.log('chat', 'MCP tools loaded', { count: tools.length });
        });
    }, []);

    // Load branches from server on mount
    useEffect(() => {
        let ignore = false;
        (async () => {
            try {
                const res = await apiClient.sessions[':id'].branches.$get({
                    param: { id: sessionId },
                });
                if (ignore || !res.ok) return;
                const data = await res.json();
                if (!ignore) {
                    setBranches(data.branches);
                    setActiveBranchId(data.activeBranchId);
                }
            } catch {
                // Branches may not exist yet, that's fine
            }
        })();
        return () => {
            ignore = true;
        };
    }, [sessionId]);

    const transport = useMemo(() => {
        return new DefaultChatTransport<Message>({
            api: apiClient.chat.$url().toString(),
            headers() {
                // Auth token is now resolved in prepareSendMessagesRequest
                // alongside the provider key to ensure both headers are always sent together
                return {};
            },
            async prepareSendMessagesRequest({ messages }) {
                const message = messages[messages.length - 1];
                if (!message) {
                    throw new Error('No message to send');
                }

                const metadata = messages.findLast(
                    (m) => m.metadata?.mode && m.metadata?.model,
                )?.metadata;

                // Prune old subagent outputs before sending to reduce context size
                // Also filter out any messages with empty parts (AI SDK can create these)
                const pruned = pruneOldMessages(messages).filter(
                    (m) => Array.isArray(m.parts) && m.parts.length > 0,
                );

                if (debug.isEnabled()) {
                    try {
                        const fs = require('fs');
                        const os = require('os');
                        const path = require('path');
                        const logDir = path.join(os.homedir(), '.nightcode');
                        if (!fs.existsSync(logDir)) {
                            fs.mkdirSync(logDir, { recursive: true });
                        }
                        const logPath = path.join(logDir, 'req-debug.log');
                        fs.writeFileSync(
                            logPath,
                            JSON.stringify(pruned, null, 2),
                            { mode: 0o600 },
                        );
                    } catch (e) {}
                }

                const modelId =
                    message?.metadata?.model ??
                    metadata?.model ??
                    DEFAULT_CHAT_MODEL_ID;

                // Resolve provider API key and auth token to send with the request
                const [providerKey, authToken] = await Promise.all([
                    (async () => {
                        try {
                            const provider = resolveProviderForModel(modelId);
                            return await getApiKeyForProvider(provider);
                        } catch {
                            return null;
                        }
                    })(),
                    (async () => {
                        const auth = getAuth();
                        return auth?.token ?? null;
                    })(),
                ]);

                const headers: Record<string, string> = {};
                if (authToken) {
                    headers['Authorization'] = `Bearer ${authToken}`;
                }
                if (providerKey) {
                    headers['x-provider-key'] = providerKey;
                }

                return {
                    body: {
                        id: sessionId,
                        messages: pruned,
                        mode:
                            message?.metadata?.mode ??
                            metadata?.mode ??
                            Mode.BUILD,
                        model: modelId,
                        mcpTools:
                            mcpToolsRef.current.length > 0
                                ? mcpToolsRef.current
                                : undefined,
                    },
                    headers,
                };
            },
        });
    }, [sessionId]);

    const chat = useAIChat<Message>({
        id: sessionId,
        messages: initialMessages,
        transport,
        onToolCall({ toolCall }) {
            const lastWithMeta = [...chat.messages]
                .reverse()
                .find((m) => m.metadata?.mode && m.metadata?.model);
            const mode = lastWithMeta?.metadata?.mode ?? 'BUILD';
            const model = lastWithMeta?.metadata?.model;
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
                flushPendingToolCalls(mode, model);
            }, 50);
        },
        sendAutomaticallyWhen: (msgs) => {
            if (isInterruptedRef.current) return false;
            return lastAssistantMessageIsCompleteWithToolCalls(msgs);
        },
    });

    // Store chat ref for access in callbacks
    chatRef.current = chat;

    // Flush collected tool calls — executes single tools directly, batches multiple via batchManager
    const flushPendingToolCalls = useCallback(
        (mode: ModeType, model: SupportedChatModelId | string | undefined) => {
            const pending = Array.from(pendingToolCallsRef.current.values());
            pendingToolCallsRef.current.clear();

            if (pending.length === 0) return;

            // Enforce per-response spawn cap to prevent runaway spawning
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
                // Report errors for rejected spawn calls
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

            const runTool = async (
                tc: PendingToolCall & { isMcpTool: boolean },
            ) => {
                const abortController = new AbortController();
                activeToolControllers.current.set(
                    tc.toolCallId,
                    abortController,
                );

                if (!tc.isMcpTool && isConfirmationEnabled()) {
                    const { level, reason } = getConfirmationLevel(
                        tc.toolName,
                        tc.input,
                    );
                    if (level === 'confirm') {
                        const details = formatToolInput(tc.toolName, tc.input);
                        const confirmed =
                            await confirmationManagerRef.current.request(
                                tc.toolName,
                                reason,
                                details,
                                getAccessPath(tc.toolName, tc.input),
                                getPatterns(tc.toolName, tc.input),
                            );
                        if (!confirmed) {
                            return { output: 'Action cancelled by user' };
                        }
                    }
                }

                const execId = setExecutionContext(tc.toolCallId);
                setCurrentToolCallContext(tc.toolCallId);
                try {
                    return tc.isMcpTool
                        ? callMcpTool(tc.toolName, tc.input)
                        : executeLocalTool(
                              tc.toolName,
                              tc.input,
                              mode,
                              model,
                              abortController.signal,
                              execId,
                          );
                } finally {
                    // Only clear if this tool still owns the context (prevents clobbering
                    // context set by orchestratorTool or other tools that set their own)
                    if (getCurrentToolCallContext() === tc.toolCallId) {
                        setCurrentToolCallContext(null);
                    }
                }
            };

            const reportResult = (
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
            };

            const reportError = (
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
            };

            // Single tool call — execute directly
            if (pending.length === 1) {
                const tc = pending[0]!;
                const startTime = Date.now();
                void runTool(tc)
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
                            if (!isMcp && isConfirmationEnabled()) {
                                const { level, reason } = getConfirmationLevel(
                                    toolName,
                                    input,
                                );
                                if (level === 'confirm') {
                                    const details = formatToolInput(
                                        toolName,
                                        input,
                                    );
                                    const confirmed =
                                        await confirmationManagerRef.current.request(
                                            toolName,
                                            reason,
                                            details,
                                            getAccessPath(toolName, input),
                                            getPatterns(toolName, input),
                                        );
                                    if (!confirmed)
                                        return {
                                            output: 'Action cancelled by user',
                                        };
                                }
                            }
                            const execId = tc
                                ? setExecutionContext(tc.toolCallId)
                                : undefined;
                            setCurrentToolCallContext(tc?.toolCallId ?? null);
                            try {
                                return isMcp
                                    ? callMcpTool(toolName, input)
                                    : executeLocalTool(
                                          toolName,
                                          input,
                                          execMode,
                                          execModel,
                                          execSignal,
                                          execId,
                                      );
                            } finally {
                                // Only clear if this tool still owns the context
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
                    void runTool(tc)
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
        [sessionId, chat],
    );

    // The messages shown depend on active branch
    const effectiveMessages = useMemo(() => {
        if (activeBranchId === 'main') return chat.messages;
        return branchMessages[activeBranchId] ?? chat.messages;
    }, [activeBranchId, chat.messages, branchMessages]);

    const abortAllTools = useCallback(() => {
        isInterruptedRef.current = true;
        activeToolControllers.current.forEach((c) => c.abort());
        activeToolControllers.current.clear();
        chat.stop();
    }, [chat.stop]);

    // Derive cumulative token usage from message metadata
    const tokenUsage = useMemo(() => {
        let inputTokens = 0;
        let outputTokens = 0;

        for (const msg of chat.messages) {
            const usage = msg.metadata?.usage as any;
            if (usage) {
                inputTokens += usage.promptTokens ?? 0;
                outputTokens += usage.completionTokens ?? 0;
            }
        }

        // Cost estimate removed — pricing is derived server-side via credits.ts
        return {
            inputTokens,
            outputTokens,
            totalCost: 0,
            hasActivity: chat.messages.some((m) => m.role === 'user'),
        };
    }, [chat.messages]);

    const lastMessage = chat.messages.at(-1);
    const runningToolNames = useMemo(() => {
        if (!lastMessage) return [];
        const names: string[] = [];
        for (const p of lastMessage.parts) {
            if (
                p.type === 'dynamic-tool' ||
                (typeof p.type === 'string' && p.type.startsWith('tool-'))
            ) {
                const toolPart = p as any;
                if (
                    toolPart.state !== 'output-available' &&
                    toolPart.state !== 'output-error'
                ) {
                    const name =
                        p.type === 'dynamic-tool'
                            ? toolPart.toolName
                            : p.type.slice('tool-'.length);
                    names.push(name);
                }
            }
        }
        return names;
    }, [lastMessage]);

    const runningToolName =
        runningToolNames.length > 0 ? runningToolNames.join(' + ') : null;

    const createBranch = useCallback(
        async (messageIndex?: number) => {
            const idx = messageIndex ?? Math.max(0, chat.messages.length - 1);
            try {
                const res = await apiClient.sessions[':id'].branches.$post({
                    param: { id: sessionId },
                    json: { parentMessageIndex: idx },
                });
                if (!res.ok) throw new Error('Failed to create branch');
                const newBranch: ConversationBranch = await res.json();
                setBranches((prev) => [...prev, newBranch]);
                setActiveBranchId(newBranch.id);

                // Snapshot messages up to the branch point
                const snapshot = chat.messages.slice(0, idx);
                setBranchMessages((prev) => ({
                    ...prev,
                    [newBranch.id]: [...snapshot],
                }));
            } catch (err) {
                console.error('Failed to create branch:', err);
            }
        },
        [chat.messages, sessionId],
    );

    const switchBranch = useCallback(
        async (branchId: string) => {
            try {
                const res = await apiClient.sessions[':id'][
                    'active-branch'
                ].$put({
                    param: { id: sessionId },
                    json: { branchId },
                });
                if (!res.ok) throw new Error('Failed to switch branch');
                setActiveBranchId(branchId);
            } catch (err) {
                console.error('Failed to switch branch:', err);
            }
        },
        [sessionId],
    );

    const deleteBranch = useCallback(
        async (branchId: string) => {
            if (branchId === 'main') return;
            try {
                const res = await apiClient.sessions[':id'].branches[
                    ':branchId'
                ].$delete({
                    param: { id: sessionId, branchId },
                });
                if (!res.ok) throw new Error('Failed to delete branch');
                setBranches((prev) => prev.filter((b) => b.id !== branchId));
                setBranchMessages((prev) => {
                    const next = { ...prev };
                    delete next[branchId];
                    return next;
                });
                if (activeBranchId === branchId) {
                    setActiveBranchId('main');
                }
            } catch (err) {
                console.error('Failed to delete branch:', err);
            }
        },
        [activeBranchId, sessionId],
    );

    return {
        messages: effectiveMessages,
        imageAttachments,
        status: chat.status,
        error: chat.error,
        tokenUsage,
        isLoading:
            chat.status === 'submitted' ||
            chat.status === 'streaming' ||
            (chat.status === 'ready' &&
                chat.messages.at(-1)?.parts.some((p: any) => {
                    if (
                        p.type === 'dynamic-tool' ||
                        (typeof p.type === 'string' &&
                            p.type.startsWith('tool-'))
                    ) {
                        const toolPart = p as any;
                        return (
                            toolPart.state !== 'output-available' &&
                            toolPart.state !== 'output-error'
                        );
                    }
                    return false;
                })),
        runningToolName,
        submit: (params: {
            userText: string;
            mode: ModeType;
            model: string;
        }) => {
            isInterruptedRef.current = false;
            debug.log('chat', 'Submitting message', {
                mode: params.mode,
                model: params.model,
                messageLength: params.userText.length,
            });

            const files = imageAttachments.map((img) => ({
                type: 'file' as const,
                mediaType: img.mimeType,
                filename: img.name,
                url: img.dataUrl,
            }));

            // Clear attachments after submitting
            if (imageAttachments.length > 0) {
                setImageAttachments([]);
            }

            return chat.sendMessage({
                text: params.userText,
                files: files.length > 0 ? files : undefined,
                metadata: {
                    mode: params.mode,
                    model: params.model,
                },
            } as any);
        },
        addImageAttachment: (attachment: ImageAttachment) => {
            setImageAttachments((prev) => [...prev, attachment]);
        },
        removeImageAttachment: (index: number) => {
            setImageAttachments((prev) => prev.filter((_, i) => i !== index));
        },
        clearImageAttachments: () => {
            setImageAttachments([]);
        },
        clearMessages: () => {
            abortAllTools();
            chat.setMessages([]);
        },
        retryLast: () => {
            isInterruptedRef.current = false;
            const messages = chat.messages;
            const lastUserIdx = messages.findLastIndex(
                (m) => m.role === 'user',
            );
            if (lastUserIdx === -1) return;
            const lastUserMsg = messages[lastUserIdx]!;

            // Reconstruct parts from the original message
            const textParts = lastUserMsg.parts
                .filter(
                    (p): p is { type: 'text'; text: string } =>
                        p.type === 'text',
                )
                .map((p) => p.text)
                .join('');
            const imageParts = lastUserMsg.parts.filter(
                (p) =>
                    (p as any).type === 'image' || (p as any).type === 'file',
            ) as any[];

            if (!textParts && imageParts.length === 0) return;
            abortAllTools();
            chat.setMessages(messages.slice(0, lastUserIdx));

            const files = imageParts.map((p) => ({
                type: 'file' as const,
                mediaType: p.mediaType || 'image/png',
                filename: p.filename || 'image.png',
                url: p.url || p.image,
            }));

            chat.sendMessage({
                text: textParts,
                files: files.length > 0 ? files : undefined,
                metadata: lastUserMsg.metadata,
            } as any);
        },
        abort: abortAllTools,
        interrupt: abortAllTools,
        branches,
        activeBranchId,
        createBranch,
        switchBranch,
        deleteBranch,
        confirmationManager: confirmationManagerRef.current,
        questionManager,
    };
}
