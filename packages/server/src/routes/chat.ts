import { z } from 'zod';
import { Hono } from 'hono';
import {
    convertToModelMessages,
    streamText,
    tool,
    validateUIMessages,
    type InferUITools,
    type LanguageModelUsage,
    type UIMessage,
} from 'ai';

import { zValidator } from '@hono/zod-validator';
import { jsonSchema } from 'ai';

import { db } from '@nightcode/database/client';
import type { Prisma } from '@nightcode/database';
import {
    getToolContracts,
    modeSchema,
    type ModeType,
    type ToolContracts,
} from '@nightcode/shared';

import {
    ingestAIUsage,
    getAvailableCreditsBalance,
    getCachedCreditsBalance,
} from '../lib/polar';
import { buildSystemPrompt } from '../system-prompt';
import { estimateTokens } from '../lib/prompt-optimizer';
import { calculateCreditsForUsage } from '../lib/credits';
import type { AuthenticatedEnv } from '../middleware/require-auth';
import { resolveChatModel, type ResolvedModel } from '../lib/models';
import { generateSessionTitle } from '../lib/generate-session-title';
import { withFallback } from '../lib/fallback';
import { serverDebug } from '../lib/debug';

const MAX_STREAM_RETRIES = 3;

/**
 * Model context windows (max input tokens). Used to compute dynamic token budget.
 * Budget = contextWindow * 0.80 (leave room for system prompt + tools + output).
 * Falls back to 100K for unknown models.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // Claude models
    'claude-opus-4-20250514': 200_000,
    'claude-sonnet-4-20250514': 200_000,
    'claude-3-5-haiku-20241022': 200_000,
    // GPT models
    'gpt-4o': 128_000,
    'gpt-4o-mini': 128_000,
    'gpt-4-turbo': 128_000,
    o1: 200_000,
    'o1-mini': 128_000,
    o3: 200_000,
    'o3-mini': 200_000,
    // Gemini models
    'gemini-2.5-pro': 1_000_000,
    'gemini-2.5-flash': 1_000_000,
    'gemini-2.0-flash': 1_000_000,
    // DeepSeek
    'deepseek-chat': 64_000,
    'deepseek-reasoner': 64_000,
};

const DEFAULT_CONTEXT_WINDOW = 100_000;
const CONTEXT_BUDGET_RATIO = 0.8;

function getContextBudget(modelId: string): number {
    // Try exact match first, then prefix match
    const exact = MODEL_CONTEXT_WINDOWS[modelId];
    if (exact) return Math.floor(exact * CONTEXT_BUDGET_RATIO);

    // Prefix match for provider-prefixed IDs (e.g. "anthropic/claude-sonnet-4-20250514")
    const baseId = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    const base = MODEL_CONTEXT_WINDOWS[baseId];
    if (base) return Math.floor(base * CONTEXT_BUDGET_RATIO);

    return Math.floor(DEFAULT_CONTEXT_WINDOW * CONTEXT_BUDGET_RATIO);
}

/**
 * Estimate tokens for a single UIMessage by summing text in all parts.
 * Results are cached by message ID to avoid redundant JSON.stringify calls.
 */
function estimateMessageTokens(
    message: NightCodeUIMessage,
    cache?: Map<string, number>,
): number {
    if (cache?.has(message.id)) return cache.get(message.id)!;

    let total = 0;
    for (const part of message.parts) {
        if (part.type === 'text') {
            total += Math.ceil((part as { text: string }).text.length / 4);
        } else if (
            part.type === 'dynamic-tool' ||
            part.type.startsWith('tool-')
        ) {
            const toolPart = part as any;
            if (toolPart.input && typeof toolPart.input === 'object') {
                total += Math.ceil(JSON.stringify(toolPart.input).length / 4);
            }
            if (
                toolPart.state === 'output-available' &&
                toolPart.output != null
            ) {
                total += Math.ceil(JSON.stringify(toolPart.output).length / 4);
            }
            if (toolPart.state === 'output-error' && toolPart.errorText) {
                total += Math.ceil(toolPart.errorText.length / 4);
            }
        }
    }
    // Add overhead for message structure (role, id, metadata)
    const result = total + 20;
    cache?.set(message.id, result);
    return result;
}

const mcpToolSchema = z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    serverName: z.string(),
});

type ChatMessageMetadata = {
    mode?: ModeType;
    model?: string;
    durationMs?: number;
    usage?: LanguageModelUsage;
    note?: string;
};

type NightCodeUIMessage = UIMessage<
    ChatMessageMetadata,
    never,
    InferUITools<ToolContracts>
>;

const submitSchema = z.object({
    id: z.string(),
    messages: z
        .array(
            z.custom<NightCodeUIMessage>((value) => {
                return (
                    value != null &&
                    typeof value === 'object' &&
                    'id' in value &&
                    'parts' in value
                );
            }),
        )
        .min(1),
    mode: modeSchema,
    model: z.string().min(1, 'Model ID is required'),
    mcpTools: z.array(mcpToolSchema).optional(),
    projectContext: z.string().optional(),
    corrections: z.array(z.string()).optional(),
    positives: z.array(z.string()).optional(),
    errorWarnings: z.array(z.string()).optional(),
});

const submitValidator = zValidator('json', submitSchema, (result, c) => {
    if (!result.success) {
        return c.json({ error: 'Invalid request body' }, 400);
    }
});

function hasPendingToolCalls(message: NightCodeUIMessage) {
    return message.parts.some((part) => {
        if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
            const state = (part as { state?: string }).state;
            return state !== 'output-available' && state !== 'output-error';
        }

        return false;
    });
}

const app = new Hono<AuthenticatedEnv>().post(
    '/',
    submitValidator,
    async (c) => {
        const userId = c.get('userId');
        const {
            id,
            messages,
            mode,
            model,
            mcpTools,
            projectContext,
            corrections,
            positives,
            errorWarnings,
        } = c.req.valid('json');
        const providerApiKey = c.req.header('x-provider-key') ?? undefined;

        const reqId = Math.random().toString(36).slice(2, 8);
        console.log(
            `[chat:${reqId}] → Request: model=${model} mode=${mode} messages=${messages.length} session=${id.slice(0, 8)} mcpTools=${mcpTools?.length ?? 0}`,
        );
        serverDebug.log('chat', 'Request received', {
            reqId,
            sessionId: id,
            mode,
            model,
            messageCount: messages.length,
            hasMcpTools: !!mcpTools?.length,
        });

        let session;
        try {
            session = await db.session.findUnique({
                where: { id, userId },
            });
        } catch (dbError) {
            console.error(
                `[chat:${reqId}] DB error looking up session:`,
                dbError,
            );
            return c.json({ error: 'Database error' }, 503);
        }

        if (!session) {
            return c.json({ error: 'Session not found' }, 404);
        }

        // Non-blocking credits check: use cache if available, fail-open on first request
        const cachedBalance = getCachedCreditsBalance(userId);
        if (cachedBalance !== null && cachedBalance <= 0) {
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
                    `[chat:${reqId}] Background credit refresh failed:`,
                    err,
                );
            });
        }

        const startTime = Date.now();
        const systemPrompt = buildSystemPrompt({
            mode,
            projectContext,
            currentModel: model,
            corrections,
            positives,
            errorWarnings,
        });
        const tokenCount = estimateTokens(systemPrompt);
        console.log(
            `[chat:${reqId}]   System prompt: ~${tokenCount} tokens (~${((tokenCount * 4) / 1024).toFixed(1)}KB) projectContext=${projectContext ? `${projectContext.length} chars` : 'none'}`,
        );
        const builtinTools = getToolContracts(mode);
        const builtinToolNames = Object.keys(builtinTools);
        console.log(
            `[chat:${reqId}]   Builtin tools (${builtinToolNames.length}): ${builtinToolNames.join(', ')}`,
        );

        // Merge MCP tools (dynamic, from the CLI) with built-in tools
        const dynamicTools = mcpTools?.reduce(
            (acc, t) => {
                acc[t.name] = tool({
                    description: t.description,
                    inputSchema: jsonSchema(
                        t.inputSchema as Parameters<typeof jsonSchema>[0],
                    ),
                });
                return acc;
            },
            {} as Record<string, ReturnType<typeof tool>>,
        );

        const mcpToolNames = dynamicTools ? Object.keys(dynamicTools) : [];
        if (mcpToolNames.length > 0) {
            console.log(
                `[chat:${reqId}]   MCP tools (${mcpToolNames.length}): ${mcpToolNames.join(', ')}`,
            );
        }

        const tools =
            dynamicTools && Object.keys(dynamicTools).length > 0
                ? { ...builtinTools, ...dynamicTools }
                : builtinTools;
        const totalToolCount = Object.keys(tools).length;
        console.log(`[chat:${reqId}]   Total tools: ${totalToolCount}`);

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
                },
            };
        });

        // Token-budget truncation: keep messages within context window
        // Dynamic budget based on model's context window (80% of max)
        const contextBudget = getContextBudget(model);
        const tokenCache = new Map<string, number>();
        // Always preserve the first user message as a context anchor
        const firstUserIdx = mergedMessages.findIndex((m) => m.role === 'user');
        const totalTokens = mergedMessages.reduce(
            (sum, m) => sum + estimateMessageTokens(m, tokenCache),
            0,
        );
        console.log(
            `[chat:${reqId}]   Previous messages in session: ${previousMessage.length}, merged: ${mergedMessages.length}, total tokens: ~${totalTokens}, budget: ${contextBudget} (model: ${model})`,
        );
        let truncatedMessages: NightCodeUIMessage[] = mergedMessages;
        if (totalTokens > contextBudget) {
            const firstUserMessage =
                firstUserIdx >= 0 ? mergedMessages[firstUserIdx] : null;
            const firstUserTokens = firstUserMessage
                ? estimateMessageTokens(firstUserMessage, tokenCache)
                : 0;

            // Reserve budget for first message + context anchor
            const availableBudget = contextBudget - firstUserTokens - 200; // 200 for anchor overhead

            // Walk backwards from end, accumulating messages until budget exhausted
            let tokenSum = 0;
            let cutoffIndex = mergedMessages.length;
            for (let i = mergedMessages.length - 1; i >= 0; i--) {
                const msg = mergedMessages[i];
                if (!msg) continue;
                const msgTokens = estimateMessageTokens(msg, tokenCache);
                if (tokenSum + msgTokens > availableBudget) {
                    cutoffIndex = i + 1;
                    break;
                }
                tokenSum += msgTokens;
                cutoffIndex = i;
            }

            // Ensure we don't skip past the first user message
            if (firstUserMessage && cutoffIndex <= firstUserIdx) {
                cutoffIndex = firstUserIdx + 1;
            }

            const tail = mergedMessages.slice(cutoffIndex);
            truncatedMessages = firstUserMessage
                ? [firstUserMessage, ...tail]
                : tail;

            // Inject context anchor so the LLM knows what the original goal was
            if (firstUserMessage) {
                const firstUserText = firstUserMessage.parts
                    .filter((p: any) => p.type === 'text')
                    .map((p: any) => (p as { text: string }).text)
                    .join('')
                    .slice(0, 500);

                if (firstUserText) {
                    const contextMessage = {
                        id: crypto.randomUUID(),
                        role: 'system' as const,
                        parts: [
                            {
                                type: 'text' as const,
                                text: `[Context: Earlier conversation history (${mergedMessages.length - truncatedMessages.length} messages, ~${totalTokens - tokenSum - firstUserTokens} tokens) was truncated to stay within context limits. The original user goal was: "${firstUserText}"]`,
                            },
                        ],
                    } as NightCodeUIMessage;
                    truncatedMessages = [contextMessage, ...truncatedMessages];
                }
            }
        }

        const nextMessages = await validateUIMessages<NightCodeUIMessage>({
            messages: truncatedMessages,
            tools,
        });
        const modelMessages = await convertToModelMessages(nextMessages, {
            tools,
        });
        console.log(
            `[chat:${reqId}]   After truncation: ${truncatedMessages.length} msgs → validated: ${nextMessages.length} → modelMessages: ${modelMessages.length}`,
        );
        let completedUsage: LanguageModelUsage | null = null;
        let actualModel: ResolvedModel = await resolveChatModel(
            model,
            providerApiKey,
        );
        console.log(
            `[chat:${reqId}]   Model resolved: provider=${actualModel.provider} modelId=${actualModel.modelId}`,
        );

        const { result, modelUsed, fallbackTriggered, note } =
            await withFallback(
                async (modelId) => {
                    const resolved = await resolveChatModel(
                        modelId,
                        providerApiKey,
                    );
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

        console.log(
            `[chat:${reqId}]   Stream started, waiting for response...`,
        );
        serverDebug.log('chat', `Starting stream with ${totalToolCount} tools`);
        return result.toUIMessageStreamResponse<NightCodeUIMessage>({
            originalMessages: nextMessages,
            messageMetadata({ part }) {
                if (part.type === 'start') {
                    return {
                        mode,
                        model: fallbackTriggered ? modelUsed : model,
                        ...(note ? { note } : {}),
                    };
                }

                if (part.type !== 'finish') {
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
                // Always persist messages — including partial results from interrupted streams.
                // Pending tool calls are marked in the message metadata so the client
                // can detect and handle them on reload (e.g. by showing a "resume" prompt).
                try {
                    await db.session.update({
                        where: { id, userId },
                        data: {
                            messages:
                                event.messages as unknown as Prisma.InputJsonValue,
                        },
                    });
                } catch (saveError) {
                    console.error(
                        `[chat:${reqId}] Failed to save messages:`,
                        saveError,
                    );
                }

                // Skip title generation and billing for aborted streams
                if (event.isAborted) {
                    console.log(
                        `[chat:${reqId}] ✗ Aborted after ${Date.now() - startTime}ms`,
                    );
                    return;
                }

                const elapsed = Date.now() - startTime;
                const tokens = completedUsage
                    ? (completedUsage.inputTokens ?? 0) +
                      (completedUsage.outputTokens ?? 0)
                    : 0;
                console.log(
                    `[chat:${reqId}] ✓ Complete: ${elapsed}ms ${tokens} tokens (${completedUsage?.inputTokens ?? 0} in / ${completedUsage?.outputTokens ?? 0} out) provider=${actualModel.provider} model=${actualModel.modelId}`,
                );

                if (hasPendingToolCalls(event.responseMessage)) return;

                // Auto-generate title on the first completed exchange of the session.
                // Key off durationMs which is only set on successful finish via messageMetadata,
                // not on aborted/partial assistant messages that also get persisted.
                const hasCompletedExchange = previousMessage.some(
                    (m) =>
                        m.role === 'assistant' &&
                        (m.metadata as ChatMessageMetadata)?.durationMs != null,
                );
                if (!hasCompletedExchange) {
                    const firstUserText =
                        messages
                            .find((m) => m.role === 'user')
                            ?.parts.filter((p) => p.type === 'text')
                            .map((p) => (p as { text: string }).text)
                            .join('') ?? '';

                    if (firstUserText) {
                        generateSessionTitle(firstUserText)
                            .then((title) =>
                                db.session.update({
                                    where: { id, userId },
                                    data: { title },
                                }),
                            )
                            .catch((err) => {
                                console.error(
                                    `[chat:${reqId}] Title generation failed:`,
                                    err,
                                );
                            });
                    }
                }

                if (!completedUsage) return;

                const billableUsage = calculateCreditsForUsage({
                    provider: actualModel.provider,
                    model: actualModel.modelId,
                    usage: completedUsage,
                });
                console.log(
                    `[chat:${reqId}]   Billing: ${billableUsage.credits} credits for ${actualModel.provider}/${actualModel.modelId}`,
                );

                ingestAIUsage({
                    externalCustomerId: userId,
                    eventId: `chat-message:${event.responseMessage.id}`,
                    credits: billableUsage.credits,
                }).catch((err) => {
                    console.error(
                        `[chat:${reqId}]   Billing failed:`,
                        err instanceof Error ? err.message : err,
                    );
                });
            },
            onError(error) {
                const name =
                    error instanceof Error
                        ? error.constructor.name
                        : 'UnknownError';
                const msg =
                    error instanceof Error ? error.message : String(error);
                console.error(
                    `[chat:${reqId}] ✗ Error after ${Date.now() - startTime}ms (${name}): ${msg}`,
                );
                return `${name}: ${msg}`;
            },
        });
    },
);

export default app;
