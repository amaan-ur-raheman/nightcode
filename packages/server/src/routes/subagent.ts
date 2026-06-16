import { z } from 'zod';
import { Hono } from 'hono';
import {
    convertToModelMessages,
    streamText,
    validateUIMessages,
    type LanguageModelUsage,
    type UIMessage,
    type InferUITools,
} from 'ai';
import { zValidator } from '@hono/zod-validator';

import {
    getSubagentToolContracts,
    modeSchema,
    type ModeType,
    type ToolContracts,
} from '@nightcode/shared';
import { buildSubagentSystemPrompt } from '../system-prompt';
import { resolveSubagentChatModel } from '../lib/models';
import {
    getAvailableCreditsBalance,
    getCachedCreditsBalance,
    ingestAIUsage,
} from '../lib/polar';
import { calculateCreditsForUsage } from '../lib/credits';
import { withFallback } from '../lib/fallback';
import type { AuthenticatedEnv } from '../middleware/require-auth';

type ChatMessageMetadata = {
    mode?: ModeType;
    model?: string;
    durationMs?: number;
    usage?: LanguageModelUsage;
};

type NightCodeUIMessage = UIMessage<
    ChatMessageMetadata,
    never,
    InferUITools<ToolContracts>
>;

const subagentSchema = z.object({
    messages: z.array(z.any()).min(1),
    model: z.string().min(1, 'Model ID is required'),
    mode: modeSchema,
    agentId: z.string().optional(),
    projectContext: z.string().optional(),
    corrections: z.array(z.string()).optional(),
    positives: z.array(z.string()).optional(),
    errorWarnings: z.array(z.string()).optional(),
});

const app = new Hono<AuthenticatedEnv>().post(
    '/',
    zValidator('json', subagentSchema, (result, c) => {
        if (!result.success)
            return c.json({ error: 'Invalid request body' }, 400);
    }),
    async (c) => {
        const userId = c.get('userId');
        const {
            messages,
            model,
            mode,
            agentId,
            projectContext,
            corrections,
            positives,
            errorWarnings,
        } = c.req.valid('json');
        const providerApiKey = c.req.header('x-provider-key') ?? undefined;

        const reqId = agentId ?? Math.random().toString(36).slice(2, 8);
        console.log(
            `[subagent:${reqId}] → Request: model=${model} mode=${mode} messages=${messages.length}`,
        );
        const uniqueRoles = [
            ...new Set(
                (messages as Record<string, unknown>[]).map(
                    (m) => m.role ?? 'unknown',
                ),
            ),
        ];
        console.log(
            `[subagent:${reqId}]   Message roles: [${uniqueRoles.join(',')}] total=${messages.length}`,
        );

        // Non-blocking credits check: use cache if available, fail-open on first request
        const cachedBalance = getCachedCreditsBalance(userId);
        if (cachedBalance !== null && cachedBalance <= 0) {
            console.log(
                `[subagent:${reqId}] ✗ No credits remaining for user ${userId.slice(0, 8)}`,
            );
            return c.json(
                {
                    error: 'No credits remaining. Run /upgrade to buy more credits',
                },
                402,
            );
        }
        if (cachedBalance === null) {
            // Fire-and-forget refresh for next request
            getAvailableCreditsBalance(userId).catch((err) => {
                console.error(
                    `[subagent:${reqId}] Background credit refresh failed:`,
                    err,
                );
            });
        }

        const startTime = Date.now();
        const resolvedModel = await resolveSubagentChatModel(
            model,
            providerApiKey,
        );
        console.log(
            `[subagent:${reqId}] → Resolved: provider=${resolvedModel.provider} model=${resolvedModel.modelId}`,
        );
        const tools = getSubagentToolContracts(mode);
        const toolNames = Object.keys(tools);
        console.log(
            `[subagent:${reqId}]   Tools (${toolNames.length}): ${toolNames.join(', ')}`,
        );

        const nextMessages = await validateUIMessages<NightCodeUIMessage>({
            messages,
            tools,
        });
        const modelMessages = await convertToModelMessages(nextMessages, {
            tools,
        });
        console.log(
            `[subagent:${reqId}]   Validated: ${nextMessages.length} msgs → modelMessages: ${modelMessages.length}`,
        );

        let completedUsage: LanguageModelUsage | null = null;
        let actualModel = resolvedModel;

        const { result } = await withFallback(
            async (modelId) => {
                const resolved = await resolveSubagentChatModel(
                    modelId,
                    providerApiKey,
                );
                actualModel = resolved;
                return streamText({
                    model: resolved.model,
                    system: buildSubagentSystemPrompt({
                        mode,
                        currentModel: model,
                        projectContext,
                        corrections,
                        positives,
                        errorWarnings,
                    }),
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
            2,
        );

        return result.toUIMessageStreamResponse<NightCodeUIMessage>({
            originalMessages: nextMessages,
            messageMetadata({ part }) {
                if (part.type === 'start') {
                    return { mode, model };
                }
                if (part.type !== 'finish') {
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
                    console.log(
                        `[subagent:${reqId}] ✗ Aborted after ${Date.now() - startTime}ms`,
                    );
                    return;
                }
                if (!completedUsage) return;
                const elapsed = Date.now() - startTime;
                const tokens =
                    (completedUsage.inputTokens ?? 0) +
                    (completedUsage.outputTokens ?? 0);
                console.log(
                    `[subagent:${reqId}] ✓ Complete: ${elapsed}ms ${tokens} tokens (${completedUsage.inputTokens ?? 0} in / ${completedUsage.outputTokens ?? 0} out) provider=${actualModel.provider} model=${actualModel.modelId}`,
                );
                try {
                    const billableUsage = calculateCreditsForUsage({
                        provider: actualModel.provider,
                        model: actualModel.modelId,
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
                const msg =
                    error instanceof Error ? error.message : String(error);
                console.error(
                    `[subagent:${reqId}] ✗ Error after ${Date.now() - startTime}ms: ${msg}`,
                );
                return msg;
            },
        });
    },
);

export default app;
