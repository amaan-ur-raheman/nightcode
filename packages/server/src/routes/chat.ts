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

import { ingestAIUsage, getAvailableCreditsBalance } from "../lib/polar";
import { buildSystemPrompt } from "../system-prompt";
import { calculateCreditsForUsage } from "../lib/credits";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { generateSessionTitle } from "../lib/generate-session-title";

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

            const creditsBalance = await getAvailableCreditsBalance(userId);
            if (creditsBalance <= 0) {
                return c.json({ error: "No credits remaining. Run /upgrade to buy more credits" }, 402);
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
            const mergedMessages = [...previousMessage];

            for (const message of messages) {
                const incomingMessage = {
                    ...message,
                    metadata: {
                        ...message.metadata,
                        mode,
                        model,
                    }
                } satisfies NightCodeUIMessage;

                const existingMessageIndex = mergedMessages.findIndex((m) => m.id === incomingMessage.id);

                if (existingMessageIndex === -1) {
                    mergedMessages.push(incomingMessage);
                } else {
                    mergedMessages[existingMessageIndex] = incomingMessage;
                }
            }

            const nextMessages = await validateUIMessages<NightCodeUIMessage>({
                messages: mergedMessages,
                tools,
            });
            const modelMessages = await convertToModelMessages(nextMessages, { tools });
            let completedUsage: LanguageModelUsage | null = null;

            const result = streamText({
                model: resolvedModel.model,
                system: buildSystemPrompt({ mode, projectContext, currentModel: model }),
                messages: modelMessages,
                tools,
                providerOptions: resolvedModel.providerOptions,
                onFinish: (event) => {
                    completedUsage = event.totalUsage;
                },
            });

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
                    return error instanceof Error ? error.message : String(error);
                }
            })
        }
    );

export default app;