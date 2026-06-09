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
import { calculateCreditsForUsage } from "../lib/credits";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { generateSessionTitle } from "../lib/generate-session-title";

const MAX_SESSION_MESSAGES = 50;
const MAX_STREAM_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

function isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("429") || msg.includes("rate limit")) return true;
        if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
        if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("socket hang up")) return true;
    }
    if (typeof error === "object" && error !== null && "statusCode" in error) {
        const status = (error as { statusCode: number }).statusCode;
        return status === 429 || status >= 500;
    }
    return false;
}

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
            const resolvedModel = resolveChatModel(model);
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

            const result = await (async function attemptStream() {
                for (let attempt = 1; attempt <= MAX_STREAM_RETRIES; attempt++) {
                    try {
                        return streamText({
                            model: resolvedModel.model,
                            system: buildSystemPrompt({ mode, projectContext, currentModel: model }),
                            messages: modelMessages,
                            tools,
                            providerOptions: resolvedModel.providerOptions,
                            abortSignal: AbortSignal.timeout(180_000),
                            onFinish: (event) => {
                                completedUsage = event.totalUsage;
                            },
                        });
                    } catch (error) {
                        const errorType = error instanceof Error ? error.constructor.name : "UnknownError";
                        const errorDetail = error instanceof Error ? error.message : String(error);

                        if (attempt < MAX_STREAM_RETRIES && isRetryableError(error)) {
                            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                            console.warn(`[chat] streamText attempt ${attempt}/${MAX_STREAM_RETRIES} failed (${errorType}): ${errorDetail} — retrying in ${delay}ms`);
                            await new Promise((r) => setTimeout(r, delay));
                            continue;
                        }

                        console.error(`[chat] streamText failed after ${attempt} attempt(s) (${errorType}): ${errorDetail}`);
                        throw error;
                    }
                }
                throw new Error("streamText failed after retries");
            })();

            return result.toUIMessageStreamResponse<NightCodeUIMessage>({
                originalMessages: nextMessages,
                messageMetadata({ part }) {
                    if (part.type === "start") {
                        return { mode, model };
                    }

                    if (part.type !== "finish") {
                        return undefined;
                    }

                    return {
                        mode,
                        model,
                        durationMs: Date.now() - startTime,
                        ...(completedUsage ? { usage: completedUsage } : {}),
                    };
                },
                async onFinish(event) {
                    if (event.isAborted) return;

                    if (hasPendingToolCalls(event.responseMessage)) return;

                    await db.session.update({
                        where: { id, userId },
                        data: {
                            messages: event.messages as unknown as Prisma.InputJsonValue
                        }
                    });

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
                            provider: resolvedModel.provider,
                            model: resolvedModel.modelId,
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