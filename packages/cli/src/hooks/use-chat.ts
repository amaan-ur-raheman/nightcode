import { useEffect, useMemo, useRef, useCallback, useState } from "react";
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
    type ConversationBranch,
    DEFAULT_CHAT_MODEL_ID,
    Mode,
} from "@nightcode/shared"

import { getAuth } from "@/lib/auth";
import { apiClient } from "@/lib/api-client";
import { executeLocalTool } from "@/lib/local-tools";
import { loadMcpTools, callMcpTool, getServerForTool, reconnectServer, type McpToolSchema } from "@/lib/mcp-client";
import { auditLog } from "@/lib/audit-log";
import { debug } from "@/lib/debug";
import {
    ConfirmationManager,
    getConfirmationLevel,
    formatToolInput,
} from "@/lib/tools/dangerous-ops";
import { isConfirmationEnabled } from "@/lib/settings";

const MAX_SUBAGENT_OUTPUT_CHARS = 8000;

const COST_PER_1K_INPUT = 0.0003;
const COST_PER_1K_OUTPUT = 0.0006;

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

export type Message = UIMessage<ChatMessageMetadata, any, ChatTools>;

export type ImageAttachment = {
    dataUrl: string;
    mimeType: string;
    name: string;
};

export function useChat(sessionId: string, initialMessages: Message[], initialImageAttachments?: ImageAttachment[]) {
    const mcpToolsRef = useRef<McpToolSchema[]>([]);
    const activeToolControllers = useRef<Map<string, AbortController>>(new Map());
    const cumulativeUsageRef = useRef({ inputTokens: 0, outputTokens: 0, totalCost: 0 });
    const confirmationManagerRef = useRef(new ConfirmationManager());

    // ─── Image attachments ─────────────────────────────────────────────────
    const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>(initialImageAttachments ?? []);

    // ─── Branch state ──────────────────────────────────────────────────────
    const [branches, setBranches] = useState<ConversationBranch[]>([]);
    const [activeBranchId, setActiveBranchId] = useState<string>("main");
    const [branchMessages, setBranchMessages] = useState<Record<string, Message[]>>({});

    useEffect(() => {
        loadMcpTools().then((tools) => {
            mcpToolsRef.current = tools;
            debug.log("chat", "MCP tools loaded", { count: tools.length });
        });
    }, []);

    // Load branches from server on mount
    useEffect(() => {
        let ignore = false;
        (async () => {
            try {
                const res = await apiClient.sessions[":id"].branches.$get({
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
        return () => { ignore = true; };
    }, [sessionId]);


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

                if (debug.isEnabled()) {
                    try {
                        const fs = require("fs");
                        const os = require("os");
                        const path = require("path");
                        const logDir = path.join(os.homedir(), ".nightcode");
                        if (!fs.existsSync(logDir)) {
                            fs.mkdirSync(logDir, { recursive: true });
                        }
                        const logPath = path.join(logDir, "req-debug.log");
                        fs.writeFileSync(logPath, JSON.stringify(pruned, null, 2), { mode: 0o600 });
                    } catch (e) {}
                }

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

            const execute = async () => {
                // Check if confirmation is needed
                if (!isMcpTool && isConfirmationEnabled()) {
                    const { level, reason } = getConfirmationLevel(toolCall.toolName, toolCall.input);
                    if (level === "confirm") {
                        const details = formatToolInput(toolCall.toolName, toolCall.input);
                        const confirmed = await confirmationManagerRef.current.request(
                            toolCall.toolName,
                            reason,
                            details,
                        );
                        if (!confirmed) {
                            return { output: "Action cancelled by user" };
                        }
                    }
                }

                return isMcpTool
                    ? callMcpTool(toolCall.toolName, toolCall.input)
                    : executeLocalTool(toolCall.toolName, toolCall.input, mode, model, abortController.signal);
            };

            const startTime = Date.now();

            void execute()
                .then((output) => {
                    activeToolControllers.current.delete(toolCall.toolCallId);

                    auditLog.log({
                        sessionId,
                        tool: toolCall.toolName,
                        input: toolCall.input,
                        output: typeof output === 'string' ? output : JSON.stringify(output),
                        duration: Date.now() - startTime,
                        success: true,
                    });

                    chat.addToolOutput({
                        tool: toolCall.toolName as keyof ChatTools,
                        toolCallId: toolCall.toolCallId,
                        output: typeof output === "object" && output !== null && "output" in output
                            ? (output as { output: unknown }).output
                            : output,
                    });
                })
                .catch(async (error) => {
                    activeToolControllers.current.delete(toolCall.toolCallId);

                    // Auto-reconnect MCP server on failure
                    if (isMcpTool) {
                        const serverName = getServerForTool(toolCall.toolName);
                        if (serverName) {
                            debug.log("mcp", `Tool call failed, attempting reconnect for ${serverName}`);
                            void reconnectServer(serverName);
                        }
                    }

                    auditLog.log({
                        sessionId,
                        tool: toolCall.toolName,
                        input: toolCall.input,
                        error: error instanceof Error ? error.message : String(error),
                        duration: Date.now() - startTime,
                        success: false,
                    });

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

    // The messages shown depend on active branch
    const effectiveMessages = useMemo(() => {
        if (activeBranchId === "main") return chat.messages;
        return branchMessages[activeBranchId] ?? chat.messages;
    }, [activeBranchId, chat.messages, branchMessages]);

    const abortAllTools = useCallback(() => {
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

        const totalCost =
            (inputTokens / 1000) * COST_PER_1K_INPUT +
            (outputTokens / 1000) * COST_PER_1K_OUTPUT;

        return {
            inputTokens,
            outputTokens,
            totalCost: Number(totalCost.toFixed(6)),
            hasActivity: chat.messages.some((m) => m.role === "user"),
        };
    }, [chat.messages]);

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

    const createBranch = useCallback(async (messageIndex?: number) => {
        const idx = messageIndex ?? Math.max(0, chat.messages.length - 1);
        try {
            const res = await apiClient.sessions[":id"].branches.$post({
                param: { id: sessionId },
                json: { parentMessageIndex: idx },
            });
            if (!res.ok) throw new Error("Failed to create branch");
            const newBranch: ConversationBranch = await res.json();
            setBranches((prev) => [...prev, newBranch]);
            setActiveBranchId(newBranch.id);

            // Snapshot messages up to the branch point
            const snapshot = chat.messages.slice(0, idx);
            setBranchMessages((prev) => ({ ...prev, [newBranch.id]: [...snapshot] }));
        } catch (err) {
            console.error("Failed to create branch:", err);
        }
    }, [chat.messages, sessionId]);

    const switchBranch = useCallback(async (branchId: string) => {
        try {
            const res = await apiClient.sessions[":id"]["active-branch"].$put({
                param: { id: sessionId },
                json: { branchId },
            });
            if (!res.ok) throw new Error("Failed to switch branch");
            setActiveBranchId(branchId);
        } catch (err) {
            console.error("Failed to switch branch:", err);
        }
    }, [sessionId]);

    const deleteBranch = useCallback(async (branchId: string) => {
        if (branchId === "main") return;
        try {
            const res = await apiClient.sessions[":id"].branches[":branchId"].$delete({
                param: { id: sessionId, branchId },
            });
            if (!res.ok) throw new Error("Failed to delete branch");
            setBranches((prev) => prev.filter((b) => b.id !== branchId));
            setBranchMessages((prev) => {
                const next = { ...prev };
                delete next[branchId];
                return next;
            });
            if (activeBranchId === branchId) {
                setActiveBranchId("main");
            }
        } catch (err) {
            console.error("Failed to delete branch:", err);
        }
    }, [activeBranchId, sessionId]);

    return {
        messages: effectiveMessages,
        imageAttachments,
        status: chat.status,
        error: chat.error,
        tokenUsage,
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
            debug.log("chat", "Submitting message", {
                mode: params.mode,
                model: params.model,
                messageLength: params.userText.length,
            });

            const files = imageAttachments.map(img => ({
                type: "file" as const,
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
            } as any)
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
            const messages = chat.messages;
            const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
            if (lastUserIdx === -1) return;
            const lastUserMsg = messages[lastUserIdx]!;

            // Reconstruct parts from the original message
            const textParts = lastUserMsg.parts
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("");
            const imageParts = lastUserMsg.parts
                .filter((p) => (p as any).type === "image" || (p as any).type === "file") as any[];

            if (!textParts && imageParts.length === 0) return;
            abortAllTools();
            chat.setMessages(messages.slice(0, lastUserIdx));

            const files = imageParts.map(p => ({
                type: "file" as const,
                mediaType: p.mediaType || "image/png",
                filename: p.filename || "image.png",
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
    };
}
