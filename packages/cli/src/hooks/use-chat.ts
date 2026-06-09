import { useEffect, useMemo, useRef, useCallback } from "react";
import {
    DefaultChatTransport,
    type InferUITools,
    lastAssistantMessageIsCompleteWithToolCalls,
    type LanguageModelUsage,
    type UIMessage,
} from "ai";

import { useChat as useAIChat } from "@ai-sdk/react";
import {
    type ModeType,
    type SupportedChatModelId,
    type ToolContracts,
    DEFAULT_CHAT_MODEL_ID,
    Mode,
} from "@nightcode/shared"

import { getAuth } from "@/lib/auth";
import { apiClient } from "@/lib/api-client";
import { executeLocalTool } from "@/lib/local-tools";
import { loadMcpTools, callMcpTool, type McpToolSchema } from "@/lib/mcp-client";

const MAX_SUBAGENT_OUTPUT_CHARS = 8000;

/**
 * Prune subagent tool outputs that exceed the size limit.
 * Keeps the first and last portion, replacing the middle with a truncation notice.
 */
function pruneToolOutput(output: unknown): unknown {
    if (output == null) return output;
    if (typeof output === "object" && "result" in output) {
        const result = (output as { result: string }).result;
        if (typeof result === "string" && result.length > MAX_SUBAGENT_OUTPUT_CHARS) {
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
            if (msg.role !== "assistant" || !Array.isArray(msg.parts)) return msg;
            return {
                ...msg,
                parts: msg.parts.map((part) => {
                    if (part.type === "dynamic-tool" || (typeof part.type === "string" && part.type.startsWith("tool-"))) {
                        const toolPart = part as any;
                        if (toolPart.state === "output-available" && toolPart.output != null) {
                            return { ...toolPart, output: pruneToolOutput(toolPart.output) };
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
    mode?: ModeType,
    model?: SupportedChatModelId | string,
    durationMs?: number,
    usage?: LanguageModelUsage,
};

type ChatTools = {
    [Name in keyof InferUITools<ToolContracts>]: {
        input: InferUITools<ToolContracts>[Name]["input"];
        output: unknown;
    };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export function useChat(sessionId: string, initialMessages: Message[]) {
    const mcpToolsRef = useRef<McpToolSchema[]>([]);
    const activeToolControllers = useRef<Map<string, AbortController>>(new Map());

    useEffect(() => {
        loadMcpTools().then((tools) => {
            mcpToolsRef.current = tools;
        });
    }, []);

    const transport = useMemo(() => {
        return new DefaultChatTransport<Message>({
            api: apiClient.chat.$url().toString(),
            headers() {
                const auth = getAuth();
                return auth ? { Authorization: `Bearer ${auth.token}` } : new Headers();
            },
            prepareSendMessagesRequest({ messages }) {
                const message = messages[messages.length - 1];
                if (!message) {
                    throw new Error("No message to send");
                }

                const metadata = messages.findLast(
                    (m) => m.metadata?.mode && m.metadata?.model
                )?.metadata;

                // Prune old subagent outputs before sending to reduce context size
                // Also filter out any messages with empty parts (AI SDK can create these)
                const pruned = pruneOldMessages(messages).filter(
                    (m) => Array.isArray(m.parts) && m.parts.length > 0
                );

                return {
                    body: {
                        id: sessionId,
                        messages: pruned,
                        mode: message?.metadata?.mode ?? metadata?.mode ?? Mode.BUILD,
                        model: message?.metadata?.model ?? metadata?.model ?? DEFAULT_CHAT_MODEL_ID,
                        mcpTools: mcpToolsRef.current.length > 0 ? mcpToolsRef.current : undefined,
                    },
                }
            }
        })
    }, [sessionId]);

    const chat = useAIChat<Message>({
        id: sessionId,
        messages: initialMessages,
        transport,
        onToolCall({ toolCall }) {
            const lastWithMeta = [...chat.messages].reverse().find(m => m.metadata?.mode && m.metadata?.model);
            const mode = lastWithMeta?.metadata?.mode ?? "BUILD";
            const model = lastWithMeta?.metadata?.model;
            const isMcpTool = toolCall.toolName.startsWith("mcp__");
            const abortController = new AbortController();
            activeToolControllers.current.set(toolCall.toolCallId, abortController);

            const execute = isMcpTool
                ? callMcpTool(toolCall.toolName, toolCall.input)
                : executeLocalTool(toolCall.toolName, toolCall.input, mode, model, abortController.signal);

            void execute
                .then((output) => {
                    activeToolControllers.current.delete(toolCall.toolCallId);
                    chat.addToolOutput({
                        tool: toolCall.toolName as keyof ChatTools,
                        toolCallId: toolCall.toolCallId,
                        output,
                    });
                })
                .catch((error) => {
                    activeToolControllers.current.delete(toolCall.toolCallId);
                    chat.addToolOutput({
                        tool: toolCall.toolName as keyof ChatTools,
                        toolCallId: toolCall.toolCallId,
                        state: 'output-error',
                        errorText: error instanceof Error ? error.message : String(error),
                    })
                })
        },
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls
    });

    const abortAllTools = useCallback(() => {
        activeToolControllers.current.forEach((c) => c.abort());
        activeToolControllers.current.clear();
        chat.stop();
    }, [chat.stop]);

    const lastMessage = chat.messages.at(-1);
    const runningToolName = useMemo(() => {
        if (!lastMessage) return null;
        for (const p of lastMessage.parts) {
            if (p.type === "dynamic-tool" || (typeof p.type === "string" && p.type.startsWith("tool-"))) {
                const toolPart = p as any;
                if (toolPart.state !== "output-available" && toolPart.state !== "output-error") {
                    const name = p.type === "dynamic-tool"
                        ? toolPart.toolName
                        : p.type.slice("tool-".length);
                    return name;
                }
            }
        }
        return null;
    }, [lastMessage]);

    return {
        messages: chat.messages,
        status: chat.status,
        error: chat.error,
        isLoading: chat.status === "submitted" || chat.status === "streaming" || (
            chat.status === "ready" && chat.messages.at(-1)?.parts.some((p: any) => {
                if (p.type === "dynamic-tool" || (typeof p.type === "string" && p.type.startsWith("tool-"))) {
                    const toolPart = p as any;
                    return toolPart.state !== "output-available" && toolPart.state !== "output-error";
                }
                return false;
            })
        ),
        runningToolName,
        submit: (params: { userText: string, mode: ModeType, model: SupportedChatModelId }) => {
            return chat.sendMessage({
                text: params.userText,
                metadata: {
                    mode: params.mode,
                    model: params.model,
                },
            })
        },
        clearMessages: () => {
            abortAllTools();
            chat.setMessages([]);
        },
        retryLast: () => {
            const messages = chat.messages;
            const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
            if (lastUserIdx === -1) return;
            const lastUserMsg = messages[lastUserIdx]!;
            const text = lastUserMsg.parts
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("");
            if (!text) return;
            abortAllTools();
            chat.setMessages(messages.slice(0, lastUserIdx));
            chat.sendMessage({
                text,
                metadata: lastUserMsg.metadata,
            });
        },
        abort: abortAllTools,
        interrupt: abortAllTools,
    };
}
