import { useEffect, useMemo, useRef } from "react";
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
} from "@nightcode/shared"

import { getAuth } from "@/lib/auth";
import { apiClient } from "@/lib/api-client";
import { executeLocalTool } from "@/lib/local-tools";
import { loadMcpTools, callMcpTool, type McpToolSchema } from "@/lib/mcp-client";

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
                const previousMessage = messages[messages.length - 2];
                const requestMessages =
                    message.role === "assistant" && previousMessage?.role === "user"
                        ? [previousMessage, message]
                        : [message];

                return {
                    body: {
                        id: sessionId,
                        messages: requestMessages,
                        mode: message?.metadata?.mode ?? metadata?.mode,
                        model: message?.metadata?.model ?? metadata?.model,
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
            const mode = chat.messages.at(-1)?.metadata?.mode ?? "BUILD";
            const isMcpTool = toolCall.toolName.startsWith("mcp__");

            const execute = isMcpTool
                ? callMcpTool(toolCall.toolName, toolCall.input)
                : executeLocalTool(toolCall.toolName, toolCall.input, mode);

            void execute
                .then((output) => {
                    chat.addToolOutput({
                        tool: toolCall.toolName as keyof ChatTools,
                        toolCallId: toolCall.toolCallId,
                        output,
                    });
                })
                .catch((error) => {
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

    return {
        messages: chat.messages,
        status: chat.status,
        error: chat.error,
        submit: (params: { userText: string, mode: ModeType, model: SupportedChatModelId }) => {
            return chat.sendMessage({
                text: params.userText,
                metadata: {
                    mode: params.mode,
                    model: params.model,
                },
            })
        },
        abort: chat.stop,
        interrupt: chat.stop,
    };
}
