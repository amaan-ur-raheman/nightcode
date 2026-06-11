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

import { getSubagentToolContracts, modeSchema, type ModeType, type ToolContracts } from "@nightcode/shared";
import { buildSubagentSystemPrompt } from "../system-prompt";
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
    agentId: z.string().optional(),
});

const app = new Hono<AuthenticatedEnv>()
    .post(
        "/",
        zValidator("json", subagentSchema, (result, c) => {
            if (!result.success) return c.json({ error: "Invalid request body" }, 400);
        }),
        async (c) => {
            const userId = c.get("userId");
            const { messages, model, mode, agentId } = c.req.valid("json");

            const reqId = agentId ?? Math.random().toString(36).slice(2, 8);
            console.log(`[subagent:${reqId}] → Request: model=${model} mode=${mode} messages=${messages.length}`);
            const uniqueRoles = [...new Set(messages.map((m: any) => m.role ?? 'unknown'))];
            console.log(`[subagent:${reqId}]   Message roles: [${uniqueRoles.join(',')}] total=${messages.length}`);

            const creditsBalance = await getAvailableCreditsBalance(userId);
            if (creditsBalance <= 0) {
                console.log(`[subagent:${reqId}] ✗ No credits remaining for user ${userId.slice(0, 8)}`);
                return c.json({ error: "No credits remaining. Run /upgrade to buy more credits" }, 402);
            }

            const startTime = Date.now();
            const resolvedModel = await resolveSubagentChatModel(model);
            console.log(`[subagent:${reqId}] → Resolved: provider=${resolvedModel.provider} model=${resolvedModel.modelId}`);
            const tools = getSubagentToolContracts(mode);
            const toolNames = Object.keys(tools);
            console.log(`[subagent:${reqId}]   Tools (${toolNames.length}): ${toolNames.join(', ')}`);

            const nextMessages = await validateUIMessages<NightCodeUIMessage>({
                messages,
                tools,
            });
            const modelMessages = await convertToModelMessages(nextMessages, { tools });
            console.log(`[subagent:${reqId}]   Validated: ${nextMessages.length} msgs → modelMessages: ${modelMessages.length}`);

            let completedUsage: LanguageModelUsage | null = null;

            const result = streamText({
                model: resolvedModel.model,
                system: buildSubagentSystemPrompt({ mode, currentModel: model }),
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
                    if (event.isAborted) {
                        console.log(`[subagent:${reqId}] ✗ Aborted after ${Date.now() - startTime}ms`);
                        return;
                    }
                    if (!completedUsage) return;
                    const elapsed = Date.now() - startTime;
                    const tokens = (completedUsage.inputTokens ?? 0) + (completedUsage.outputTokens ?? 0);
                    console.log(`[subagent:${reqId}] ✓ Complete: ${elapsed}ms ${tokens} tokens (${completedUsage.inputTokens ?? 0} in / ${completedUsage.outputTokens ?? 0} out) provider=${resolvedModel.provider} model=${resolvedModel.modelId}`);
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
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error(`[subagent:${reqId}] ✗ Error after ${Date.now() - startTime}ms: ${msg}`);
                    return msg;
                },
            });
        }
    );

export default app;

