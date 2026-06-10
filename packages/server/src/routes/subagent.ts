import { z } from "zod";
import { Hono } from "hono";
import {
    convertToModelMessages,
    streamText,
    validateUIMessages,
    type LanguageModelUsage,
    type UIMessage,
    type InferUITools,
} from "ai";
import { zValidator } from "@hono/zod-validator";

import { getToolContracts, modeSchema, type ModeType, type ToolContracts } from "@nightcode/shared";
import { buildSystemPrompt } from "../system-prompt";
import { isSupportedChatModel, resolveChatModel, resolveSubagentChatModel } from "../lib/models";
import { getAvailableCreditsBalance, ingestAIUsage } from "../lib/polar";
import { calculateCreditsForUsage } from "../lib/credits";
import type { AuthenticatedEnv } from "../middleware/require-auth";

type ChatMessageMetadata = {
    mode?: ModeType,
    model?: string,
    durationMs?: number,
    usage?: LanguageModelUsage,
};

type NightCodeUIMessage = UIMessage<ChatMessageMetadata, never, InferUITools<ToolContracts>>;

const subagentSchema = z.object({
    messages: z.array(z.any()).min(1),
    model: z.string().refine(isSupportedChatModel, "Unsupported model"),
    mode: modeSchema,
});

const app = new Hono<AuthenticatedEnv>()
    .post(
        "/",
        zValidator("json", subagentSchema, (result, c) => {
            if (!result.success) return c.json({ error: "Invalid request body" }, 400);
        }),
        async (c) => {
            const userId = c.get("userId");
            const { messages, model, mode } = c.req.valid("json");

            const creditsBalance = await getAvailableCreditsBalance(userId);
            if (creditsBalance <= 0) {
                return c.json({ error: "No credits remaining. Run /upgrade to buy more credits" }, 402);
            }

            const startTime = Date.now();
            const resolvedModel = await resolveSubagentChatModel(model);
            const tools = getToolContracts(mode);

            const nextMessages = await validateUIMessages<NightCodeUIMessage>({
                messages,
                tools,
            });
            const modelMessages = await convertToModelMessages(nextMessages, { tools });

            let completedUsage: LanguageModelUsage | null = null;

            const result = streamText({
                model: resolvedModel.model,
                system: buildSystemPrompt({ mode, isSubagent: true, currentModel: model }),
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
                    if (!completedUsage) return;
                    try {
                        const billableUsage = calculateCreditsForUsage({
                            provider: resolvedModel.provider,
                            model: resolvedModel.modelId,
                            usage: completedUsage,
                        });
                        await ingestAIUsage({
                            externalCustomerId: userId,
                            eventId: `subagent:${crypto.randomUUID()}`,
                            credits: billableUsage.credits,
                        });
                    } catch {
                        // non-critical
                    }
                },
                onError(error) {
                    return error instanceof Error ? error.message : String(error);
                },
            });
        }
    );

export default app;

