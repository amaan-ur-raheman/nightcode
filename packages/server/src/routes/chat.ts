import { z } from "zod";
import { Hono } from "hono";
import {
    convertToModelMessages,
    streamText,
    tool,
    validateUIMessages,
    type InferUITools,
    type LanguageModelUsage,
    type UIMessage
} from "ai";

import { zValidator } from "@hono/zod-validator";
import { jsonSchema } from "ai";

import { db } from "@nightcode/database/client";
import type { Prisma } from "@nightcode/database";
import {
    getToolContracts,
    modeSchema,
    type ModeType,
    type ToolContracts
} from "@nightcode/shared"

import { ingestAIUsage, getAvailableCreditsBalance, getCachedCreditsBalance } from "../lib/polar";
import { buildSystemPrompt } from "../system-prompt";
import { estimateTokens } from "../lib/prompt-optimizer";
import { calculateCreditsForUsage } from "../lib/credits";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { isSupportedChatModel, resolveChatModel, type ResolvedModel } from "../lib/models";
import { generateSessionTitle } from "../lib/generate-session-title";
import { withFallback } from "../lib/fallback";
import { serverDebug } from "../lib/debug";

const MAX_SESSION_MESSAGES = 50;
const MAX_STREAM_RETRIES = 3;

const mcpToolSchema = z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    serverName: z.string(),
});

type ChatMessageMetadata = {
    mode?: ModeType,
    model?: string,
    durationMs?: number,
    usage?: LanguageModelUsage,
    note?: string,
};

type NightCodeUIMessage = UIMessage<ChatMessageMetadata, never, InferUITools<ToolContracts>>;

const submitSchema = z.object({
    id: z.string(),
    messages: z
        .array(
            z.custom<NightCodeUIMessage>((value) => {
                return value != null && typeof value === "object" && "id" in value && "parts" in value
            })
        )
        .min(1)
    ,
    mode: modeSchema,
    model: z.string().refine(isSupportedChatModel, "Unsupported model"),
    mcpTools: z.array(mcpToolSchema).optional(),
    projectContext: z.string().optional(),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
    if (!result.success) {
        return c.json({ error: "Invalid request body" }, 400);
    }
});

function hasPendingToolCalls(message: NightCodeUIMessage) {
    return message.parts.some((part) => {
        if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
            const state = (part as { state?: string }).state;
            return state !== "output-available" && state !== "output-error";
        }

        return false;
    });
}

const app = new Hono<AuthenticatedEnv>()
    .post(
        "/",
        submitValidator,
        async (c) => {
            const userId = c.get("userId");
            const { id, messages, mode, model, mcpTools, projectContext } = c.req.valid("json");

            serverDebug.log("chat", "Request received", {
                sessionId: id,
                mode,
                model,
                messageCount: messages.length,
                hasMcpTools: !!mcpTools?.length,
            });

            const session = await db.session.findUnique({
                where: { id, userId }
            });

            if (!session) {
                return c.json({ error: "Session not found" }, 404);
            }

            // Non-blocking credits check: use cache if available, fail-open on first request
            const cachedBalance = getCachedCreditsBalance(userId);
            if (cachedBalance !== null && cachedBalance <= 0) {
                return c.json({ error: "No credits remaining. Run /upgrade to buy more credits" }, 402);
            }
            if (cachedBalance === null) {
                // Fire-and-forget refresh for next request
                getAvailableCreditsBalance(userId).catch(() => {});
            }

            const startTime = Date.now();
            const systemPrompt = buildSystemPrompt({ mode, projectContext, currentModel: model });
            const tokenCount = estimateTokens(systemPrompt);
            serverDebug.log("chat", `system prompt: ${tokenCount} tokens (~${(tokenCount * 4 / 1024).toFixed(1)}KB)`);
            const builtinTools = getToolContracts(mode);

            // Merge MCP tools (dynamic, from the CLI) with built-in tools
            const dynamicTools = mcpTools?.reduce((acc, t) => {
                acc[t.name] = tool({
                    description: t.description,
                    inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
                });
                return acc;
            }, {} as Record<string, ReturnType<typeof tool>>);

            const tools = dynamicTools && Object.keys(dynamicTools).length > 0
                ? { ...builtinTools, ...dynamicTools }
                : builtinTools;
            const previousMessage = Array.isArray(session.messages)
                ? (session.messages as unknown as NightCodeUIMessage[])
                : [];
            const mergedMessages: NightCodeUIMessage[] = messages.map((message) => {
                return {
                    ...message,
                    metadata: {
                        ...message.metadata,
                        mode,
                        model,
                    }
                };
            });

            // Sliding window: truncate session history to prevent context overflow
            // Always preserve the first user message as a context anchor
            const firstUserIdx = mergedMessages.findIndex(m => m.role === "user");
            let truncatedMessages: NightCodeUIMessage[] = mergedMessages;
            if (mergedMessages.length > MAX_SESSION_MESSAGES) {
                const firstUserMessage = firstUserIdx >= 0 ? mergedMessages[firstUserIdx] : null;
                const tail = mergedMessages.slice(mergedMessages.length - MAX_SESSION_MESSAGES + 1);
                truncatedMessages = firstUserMessage
                    ? [firstUserMessage, ...tail]
                    : tail;

                // Inject context anchor so the LLM knows what the original goal was
                if (firstUserMessage) {
                    const firstUserText = firstUserMessage.parts
                        .filter((p: any) => p.type === "text")
                        .map((p: any) => (p as { text: string }).text)
                        .join("")
                        .slice(0, 500);

                    if (firstUserText) {
                        const contextMessage = {
                            id: crypto.randomUUID(),
                            role: "system" as const,
                            parts: [{ type: "text" as const, text: `[Context: Earlier conversation history (${mergedMessages.length - truncatedMessages.length} messages) was truncated to stay within context limits. The original user goal was: "${firstUserText}"]` }],
                        } as NightCodeUIMessage;
                        truncatedMessages = [contextMessage, ...truncatedMessages];
                    }
                }
            }

            const nextMessages = await validateUIMessages<NightCodeUIMessage>({
                messages: truncatedMessages,
                tools,
            });
            const modelMessages = await convertToModelMessages(nextMessages, { tools });
            let completedUsage: LanguageModelUsage | null = null;
            let actualModel: ResolvedModel = await resolveChatModel(model);

            serverDebug.log("chat", "Starting stream", { model, fallbackModel: model });

            const { result, modelUsed, fallbackTriggered, note } = await withFallback(
                async (modelId) => {
                    const resolved = await resolveChatModel(modelId);
                    actualModel = resolved;
                    return streamText({
                        model: resolved.model,
                        system: systemPrompt,
                        messages: modelMessages,
                        tools,
                        providerOptions: resolved.providerOptions,
                        abortSignal: AbortSignal.timeout(180_000),
                        onFinish: (event) => {
                            completedUsage = event.totalUsage;
                        },
                    });
                },
                model,
                MAX_STREAM_RETRIES,
            );

            return result.toUIMessageStreamResponse<NightCodeUIMessage>({
                originalMessages: nextMessages,
                messageMetadata({ part }) {
                    if (part.type === "start") {
                        return {
                            mode,
                            model: fallbackTriggered ? modelUsed : model,
                            ...(note ? { note } : {}),
                        };
                    }

                    if (part.type !== "finish") {
                        return undefined;
                    }

                    return {
                        mode,
                        model: fallbackTriggered ? modelUsed : model,
                        durationMs: Date.now() - startTime,
                        ...(completedUsage ? { usage: completedUsage } : {}),
                        ...(note ? { note } : {}),
                    };
                },
                async onFinish(event) {
                    // Always persist messages (including partial results from interrupted streams)
                    if (!hasPendingToolCalls(event.responseMessage)) {
                        await db.session.update({
                            where: { id, userId },
                            data: {
                                messages: event.messages as unknown as Prisma.InputJsonValue
                            }
                        });
                    }

                    // Skip title generation and billing for aborted streams
                    if (event.isAborted) return;

                    if (hasPendingToolCalls(event.responseMessage)) return;

                    // Auto-generate title on first exchange (session had no prior messages)
                    if (previousMessage.length === 0) {
                        const firstUserText = messages
                            .find((m) => m.role === "user")
                            ?.parts
                            .filter((p) => p.type === "text")
                            .map((p) => (p as { text: string }).text)
                            .join("") ?? "";

                        if (firstUserText) {
                            generateSessionTitle(firstUserText)
                                .then((title) => db.session.update({
                                    where: { id, userId },
                                    data: { title },
                                }))
                                .catch(() => { /* non-critical */ });
                        }
                    }

                    if (!completedUsage) return;

                    try {
                        const billableUsage = calculateCreditsForUsage({
                            provider: actualModel.provider,
                            model: actualModel.modelId,
                            usage: completedUsage,
                        });

                        await ingestAIUsage({
                            externalCustomerId: userId,
                            eventId: `chat-message:${event.responseMessage.id}`,
                            credits: billableUsage.credits,
                        });
                    } catch (error) {
                        console.error("Failed to ingest Polar AI usage for chat message:", {
                            error,
                            sessionId: id,
                            messageId: event.responseMessage.id,
                            userId
                        });
                    }
                },
                onError(error) {
                    const name = error instanceof Error ? error.constructor.name : "UnknownError";
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error(`[chat] stream error (${name}):`, msg);
                    return `${name}: ${msg}`;
                }
            })
        }
    );

export default app;