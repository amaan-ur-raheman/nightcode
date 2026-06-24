import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import {
    DefaultChatTransport,
    lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';

import { useChat as useAIChat } from '@ai-sdk/react';
import {
    type ModeType,
    type SupportedChatModelId,
    DEFAULT_CHAT_MODEL_ID,
    Mode,
} from '@nightcode/shared';

import { getValidAuth } from '@/lib/auth';
import { apiClient } from '@/lib/api-client';
import { getApiKeyForProvider } from '@/lib/api-keys';
import { resolveProviderForModel } from '@nightcode/shared';
import {
    startToolUsageWindow,
    analyzeToolUsageWindow,
} from '@/lib/local-tools';
import { correctionTracker } from '@/lib/correction-tracker';
import { ErrorPatternTracker } from '@/lib/error-pattern-tracker';
import { loadMcpTools, type McpToolSchema } from '@/lib/mcp-client';
import { debug } from '@/lib/debug';
import { ConfirmationManager } from '@/lib/tools/dangerous-ops';
import { questionManager } from '@/lib/tools/question-manager';
import { getProjectCwd } from '@/lib/workspace-context';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { timelineManager } from '@/lib/timeline-manager';
import { fileWatcher } from '@/lib/file-watcher';

import {
    type ChatMessageMetadata,
    type ChatTools,
    type Message,
    type ImageAttachment,
    type PendingToolCall,
} from './use-chat/types';
import { pruneOldMessages } from './use-chat/prune';
import { triageRequest } from './use-chat/triage';
import { useBranchManager } from './use-chat/branch-manager';
import { useToolExecution } from './use-chat/tool-execution';

export type { Message, ImageAttachment };

export function useChat(
    sessionId: string,
    initialMessages: Message[],
    initialImageAttachments?: ImageAttachment[],
) {
    const isInterruptedRef = useRef(false);
    const mcpToolsRef = useRef<McpToolSchema[]>([]);
    const errorTrackerRef = useRef(new ErrorPatternTracker());
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
    const pendingSystemNoticesRef = useRef<string[]>([]);
    const isLoadingRef = useRef(false);

    // ─── Image attachments ─────────────────────────────────────────────────
    const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>(
        initialImageAttachments ?? [],
    );

    // ─── Branch state (delegated) ─────────────────────────────────────────
    const branchManager = useBranchManager(
        sessionId,
        () => chatRef.current?.messages ?? [],
    );

    useEffect(() => {
        loadMcpTools().then((tools) => {
            mcpToolsRef.current = tools;
            debug.log('chat', 'MCP tools loaded', { count: tools.length });
        });
    }, []);

    // Clean up branch-specific state when switching branches
    // Prevents pending tool calls, snapshots, and usage from leaking across branches
    useEffect(() => {
        pendingToolCallsRef.current.clear();
        if (pendingToolCallsTimer.current) {
            clearTimeout(pendingToolCallsTimer.current);
            pendingToolCallsTimer.current = null;
        }
        lastSnapshotRef.current = null;
        cumulativeUsageRef.current = {
            inputTokens: 0,
            outputTokens: 0,
            totalCost: 0,
        };
        activeToolControllers.current.forEach((c) => c.abort());
        activeToolControllers.current.clear();
    }, [branchManager.activeBranchId]);

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
                        const auth = await getValidAuth();
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

                let projectContext: string | undefined;
                try {
                    const cwd = getProjectCwd();
                    const rulesPath = join(cwd, '.agentrules');
                    if (existsSync(rulesPath)) {
                        projectContext = readFileSync(rulesPath, 'utf8');
                    }
                } catch (e) {
                    // Ignore filesystem errors
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
                        projectContext,
                        mcpTools:
                            mcpToolsRef.current.length > 0
                                ? mcpToolsRef.current
                                : undefined,
                        corrections: await correctionTracker
                            .getCorrections()
                            .then((c) => (c.length > 0 ? c : undefined)),
                        positives: await correctionTracker
                            .getPatterns()
                            .then((p) =>
                                p.positives.length > 0
                                    ? p.positives
                                    : undefined,
                            ),
                        errorWarnings:
                            errorTrackerRef.current.getSuggestions().length > 0
                                ? errorTrackerRef.current.getSuggestions()
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

            toolExecution.handleToolCall(toolCall);

            if (pendingToolCallsTimer.current) {
                clearTimeout(pendingToolCallsTimer.current);
            }
            pendingToolCallsTimer.current = setTimeout(() => {
                pendingToolCallsTimer.current = null;
                toolExecution.flushPendingToolCalls(mode, model);
            }, 50);
        },
        sendAutomaticallyWhen: (msgs) => {
            if (isInterruptedRef.current) return false;
            return lastAssistantMessageIsCompleteWithToolCalls(msgs);
        },
    });

    // Store chat ref for access in callbacks
    chatRef.current = chat;

    const isLoading = useMemo(() => {
        return (
            chat.status === 'submitted' ||
            chat.status === 'streaming' ||
            (chat.status === 'ready' &&
                !!chat.messages.at(-1)?.parts.some((p: any) => {
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
                }))
        );
    }, [chat.status, chat.messages]);

    isLoadingRef.current = isLoading;

    const lastSnapshotRef = useRef<string | null>(null);
    useEffect(() => {
        if (chat.status === 'ready' && chat.messages.length > 0) {
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
                const isComplete = !lastMsg.parts.some((p: any) => {
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
                });

                if (isComplete && lastSnapshotRef.current !== lastMsg.id) {
                    lastSnapshotRef.current = lastMsg.id;
                    const userMsgIdx = chat.messages.findLastIndex(
                        (m, idx) =>
                            m.role === 'user' && idx < chat.messages.length - 1,
                    );
                    const parentMessageId =
                        userMsgIdx >= 0
                            ? chat.messages[userMsgIdx]?.id
                            : undefined;

                    void timelineManager.takeSnapshot(
                        sessionId,
                        lastMsg.id,
                        parentMessageId,
                    );

                    // Analyze tool usage when the response completes
                    void analyzeToolUsageWindow();
                }
            }
        }
    }, [chat.status, chat.messages, sessionId]);

    // Subscribes to the fileWatcher to reactively push system messages when files change externally
    useEffect(() => {
        if (!fileWatcher.isWatching()) {
            fileWatcher.start();
        }
        const unsubscribe = fileWatcher.onChange((events) => {
            const externalChanges = events.filter((e) => !e.isInternal);
            if (externalChanges.length === 0) return;

            const changeDescriptions = externalChanges.map(
                (e) => `"${e.filePath}" was ${e.changeType} externally`,
            );

            if (isLoadingRef.current) {
                pendingSystemNoticesRef.current.push(...changeDescriptions);
                return;
            }

            const noticeText = `[System Notice: ${changeDescriptions.join(', ')}. Please re-read if necessary.]`;

            const systemMessage = {
                id: crypto.randomUUID(),
                role: 'system' as const,
                content: noticeText,
                parts: [{ type: 'text' as const, text: noticeText }],
            };

            chat.setMessages((prev) => [...prev, systemMessage]);
        });

        return () => {
            unsubscribe();
        };
    }, [chat]);

    // Flush pending system notices when isLoading transitions from true to false
    useEffect(() => {
        if (!isLoading && pendingSystemNoticesRef.current.length > 0) {
            const descriptions = [...pendingSystemNoticesRef.current];
            pendingSystemNoticesRef.current = [];

            const noticeText = `[System Notice: ${descriptions.join(', ')}. Please re-read if necessary.]`;
            const systemMessage = {
                id: crypto.randomUUID(),
                role: 'system' as const,
                content: noticeText,
                parts: [{ type: 'text' as const, text: noticeText }],
            };
            chat.setMessages((prev) => [...prev, systemMessage]);
        }
    }, [isLoading, chat]);

    // ─── Tool execution (delegated) ────────────────────────────────────────
    const toolExecution = useToolExecution(sessionId, chat, {
        activeToolControllers,
        pendingToolCallsRef,
        pendingToolCallsTimer,
        confirmationManagerRef,
    });

    // The messages shown depend on active branch
    const effectiveMessages = useMemo(() => {
        if (branchManager.activeBranchId === 'main') return chat.messages;
        return (
            branchManager.branchMessages[branchManager.activeBranchId] ??
            chat.messages
        );
    }, [
        branchManager.activeBranchId,
        chat.messages,
        branchManager.branchMessages,
    ]);

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

    const createBranch = branchManager.createBranch;
    const switchBranch = branchManager.switchBranch;
    const deleteBranch = branchManager.deleteBranch;

    // Derive streaming token count from the last message during streaming
    const streamingTokens = useMemo(() => {
        if (chat.status !== 'streaming') return 0;
        const lastMsg = chat.messages.at(-1);
        if (!lastMsg || lastMsg.role !== 'assistant') return 0;

        let textLen = 0;
        for (const part of lastMsg.parts) {
            if (part.type === 'text' && typeof part.text === 'string') {
                textLen += part.text.length;
            }
        }
        // Estimate tokens: ~4 chars per token
        return Math.ceil(textLen / 4);
    }, [chat.messages, chat.status]);

    return {
        messages: effectiveMessages,
        imageAttachments,
        status: chat.status,
        error: chat.error,
        tokenUsage,
        streamingTokens,
        isLoading,
        runningToolName,
        submit: (params: {
            userText: string;
            mode: ModeType;
            model: string;
        }) => {
            isInterruptedRef.current = false;
            startToolUsageWindow();
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

            // Pre-flight triage: analyze request and inject delegation suggestions
            let textToSend = params.userText;
            const triageNotice = triageRequest(params.userText, params.mode);
            if (triageNotice) {
                // Prepend triage notice to the user message so the model sees it first
                textToSend = `${triageNotice}\n\n${params.userText}`;
                debug.log('chat', 'Pre-flight triage injected', {
                    notice: triageNotice.slice(0, 100),
                });
            }

            return chat.sendMessage({
                text: textToSend,
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
            startToolUsageWindow();
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
        branches: branchManager.branches,
        activeBranchId: branchManager.activeBranchId,
        createBranch,
        switchBranch,
        deleteBranch,
        confirmationManager: confirmationManagerRef.current,
        questionManager,
    };
}
