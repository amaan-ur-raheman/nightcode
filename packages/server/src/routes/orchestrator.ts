import { z } from 'zod';
import { Hono } from 'hono';
import { generateText } from 'ai';
import { zValidator } from '@hono/zod-validator';
import { db } from '@nightcode/database/client';

import { modeSchema } from '@nightcode/shared';
import { buildSystemPrompt } from '../system-prompt';
import { resolveChatModel } from '../lib/models';
import { getAvailableCreditsBalance, ingestAIUsage } from '../lib/polar';
import { calculateCreditsForUsage } from '../lib/credits';
import { withFallback } from '../lib/fallback';
import type { AuthenticatedEnv } from '../middleware/require-auth';

const decomposeSchema = z.object({
    messages: z.array(z.any()).min(1),
    model: z.string().min(1, 'Model ID is required'),
    mode: modeSchema,
    strategy: z.enum(['balanced', 'speed', 'quality']).default('balanced'),
});

/**
 * Schema for validating decomposed task nodes from LLM output.
 */
const taskNodeSchema = z.object({
    id: z.string().min(1),
    type: z.enum(['coder', 'reviewer', 'tester', 'researcher', 'debugger']),
    description: z.string().min(1),
    dependencies: z.array(z.string()),
    files: z.array(z.string()),
    mode: z.enum(['BUILD', 'PLAN']),
});

const decomposedTasksSchema = z.array(taskNodeSchema);

/**
 * Extract and validate JSON from LLM response text.
 * Handles cases where LLM wraps JSON in markdown code blocks or adds extra text.
 */
function extractAndValidateDecomposition(text: string):
    | {
          success: true;
          tasks: z.infer<typeof decomposedTasksSchema>;
      }
    | {
          success: false;
          error: string;
      } {
    // Try to extract JSON array from the response
    // Look for JSON array pattern, possibly wrapped in markdown code blocks
    const jsonPatterns = [
        /```(?:json)?\s*\n?([\s\S]*?)\n?```/, // Markdown code block
        /\[[\s\S]*\]/, // Raw JSON array
    ];

    for (const pattern of jsonPatterns) {
        const match = text.match(pattern);
        if (match) {
            const jsonStr = match[1] ?? match[0];
            try {
                const parsed = JSON.parse(jsonStr);
                const result = decomposedTasksSchema.safeParse(parsed);
                if (result.success) {
                    return { success: true, tasks: result.data };
                }
                return {
                    success: false,
                    error: `Invalid task structure: ${result.error.message}`,
                };
            } catch {
                // Continue to next pattern
            }
        }
    }

    return {
        success: false,
        error: 'No valid JSON array found in LLM response',
    };
}

const syncNodesSchema = z.object({
    nodes: z.array(
        z.object({
            id: z.string(),
            graphId: z.string(),
            type: z.string(),
            description: z.string(),
            dependencies: z.array(z.string()),
            status: z.string(),
            result: z.string().optional().nullable(),
            error: z.string().optional().nullable(),
            files: z.array(z.string()).optional(),
        }),
    ),
});

const updateNodeSchema = z.object({
    status: z.string().optional(),
    result: z.string().optional().nullable(),
    error: z.string().optional().nullable(),
    description: z.string().optional(),
    files: z.array(z.string()).optional(),
});

const app = new Hono<AuthenticatedEnv>()
    .post(
        '/decompose',
        zValidator('json', decomposeSchema, (result, c) => {
            if (!result.success)
                return c.json({ error: 'Invalid request body' }, 400);
        }),
        async (c) => {
            const userId = c.get('userId');
            const { messages, model, mode, strategy } = c.req.valid('json');
            const providerApiKey = c.req.header('x-provider-key') ?? undefined;

            const reqId = Math.random().toString(36).slice(2, 8);
            console.log(
                `[orchestrator:${reqId}] → Decompose: model=${model} mode=${mode} strategy=${strategy} messages=${messages.length}`,
            );

            const creditsBalance = await getAvailableCreditsBalance(userId);
            if (creditsBalance <= 0) {
                console.log(
                    `[orchestrator:${reqId}] ✗ No credits remaining for user ${userId.slice(0, 8)}`,
                );
                return c.json(
                    {
                        error: 'No credits remaining. Run /upgrade to buy more credits',
                    },
                    402,
                );
            }

            // M4: No tools needed for decomposition — pure text generation

            const strategyHints: Record<string, string> = {
                balanced:
                    'Create 3-5 tasks with reasonable parallelism. Favor clean dependency chains.',
                speed: 'Maximize parallelism — run independent tasks simultaneously. Use 3-4 tasks.',
                quality:
                    'Create 5-7 tasks with thorough review steps. Include dedicated reviewer and tester roles.',
            };

            const decomposePrompt = [
                'You are a task decomposition engine. Given a high-level task, decompose it into a DAG of concrete subtasks.',
                '',
                'PARALLEL vs SEQUENTIAL — this is the most important rule:',
                '',
                'Use PARALLEL (empty dependencies) when:',
                '  - Tasks are independent of each other (no data flows between them)',
                '  - Different agents are gathering information from different sources',
                '  - Results can be merged later',
                '  - Examples: research + code review + documentation happening simultaneously',
                '',
                'Use SEQUENTIAL (dependencies) when:',
                '  - Later tasks NEED the output of earlier tasks to proceed',
                '  - You need validation or refinement stages',
                '  - The workflow is naturally a pipeline',
                '  - Examples: requirements → design → implementation → testing',
                '',
                'When in doubt, prefer PARALLEL — unnecessary dependencies slow everything down.',
                '',
                'Rules:',
                '- IMPORTANT: Produce at most 8 tasks. Prefer 3-6. Group related work into single tasks.',
                '- Each task must have a unique ID (lowercase-kebab-case)',
                '- Dependencies must form a DAG (no cycles)',
                '- Each task must be self-contained and assigned to an appropriate role',
                "- Roles: 'coder' for implementation, 'reviewer' for code review, 'tester' for tests, 'researcher' for investigation, 'debugger' for debugging",
                "- Mode must be 'BUILD' for tasks that modify code, 'PLAN' for read-only analysis",
                '',
                `Strategy: ${strategy} — ${strategyHints[strategy]}`,
                '',
                'Respond with ONLY a JSON array of task objects. Each object must have:',
                '- "id": unique string identifier (lowercase-kebab-case)',
                '- "type": one of "coder", "reviewer", "tester", "researcher", "debugger"',
                '- "description": clear, actionable description of what to do',
                '- "dependencies": array of task IDs that must complete first (empty [] for independent tasks that can run in parallel)',
                '- "files": array of relevant file paths (empty [] if none known)',
                '- "mode": "BUILD" or "PLAN"',
                '',
                'Example — research, code review, and docs run in parallel, then implementation depends on research:',
                '```json',
                '[',
                '  {"id": "research-auth", "type": "researcher", "description": "Research auth patterns in the codebase", "dependencies": [], "files": ["src/auth/"], "mode": "PLAN"},',
                '  {"id": "review-existing", "type": "reviewer", "description": "Review existing auth code for issues", "dependencies": [], "files": ["src/auth/"], "mode": "PLAN"},',
                '  {"id": "analyze-docs", "type": "researcher", "description": "Analyze auth documentation requirements", "dependencies": [], "files": ["docs/"], "mode": "PLAN"},',
                '  {"id": "implement-jwt", "type": "coder", "description": "Implement JWT token handler with refresh support", "dependencies": ["research-auth"], "files": ["src/auth/jwt.ts", "src/auth/types.ts"], "mode": "BUILD"},',
                '  {"id": "write-tests", "type": "tester", "description": "Write unit tests for JWT handler", "dependencies": ["implement-jwt"], "files": ["src/auth/jwt.test.ts"], "mode": "BUILD"}',
                ']',
                '```',
            ].join('\n');

            let usedProvider = '';
            let usedModelId = '';

            // #3: Use generateText instead of streamText so withFallback can actually
            // catch errors during model execution (streamText is lazy — errors happen
            // during stream consumption, not initialization, breaking the fallback chain).
            const { result } = await withFallback(
                async (modelId) => {
                    const resolved = await resolveChatModel(
                        modelId,
                        providerApiKey,
                    );
                    usedProvider = resolved.provider;
                    usedModelId = resolved.modelId;
                    return generateText({
                        model: resolved.model,
                        system: buildSystemPrompt({
                            mode,
                            currentModel: model,
                        }),
                        messages: [{ role: 'user', content: decomposePrompt }],
                        providerOptions: resolved.providerOptions,
                        abortSignal: AbortSignal.timeout(60_000),
                    });
                },
                model,
                2,
            );
            const text = result.text;
            const usage = result.usage;

            console.log(
                `[orchestrator:${reqId}] ✓ Decomposed: ${text.length} chars provider=${usedProvider} model=${usedModelId}`,
            );
            if (usage) {
                const tokens =
                    (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
                console.log(
                    `[orchestrator:${reqId}]   Tokens: ${tokens} (${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out)`,
                );
                try {
                    const billableUsage = calculateCreditsForUsage({
                        provider: usedProvider,
                        model: usedModelId,
                        usage,
                    });
                    await ingestAIUsage({
                        externalCustomerId: userId,
                        eventId: `orchestrator-decompose:${crypto.randomUUID()}`,
                        credits: billableUsage.credits,
                    });
                } catch {
                    // non-critical
                }
            }

            // Validate the decomposition output
            const validation = extractAndValidateDecomposition(text);
            if (!validation.success) {
                console.error(
                    `[orchestrator:${reqId}] ✗ Decomposition validation failed: ${validation.error}`,
                );
                return c.json(
                    {
                        error: `Failed to parse decomposition: ${validation.error}`,
                    },
                    422,
                );
            }

            // Return validated tasks
            return c.json({ tasks: validation.tasks });
        },
    )
    .post(
        '/sessions/:sessionId/graphs/:graphId/nodes',
        zValidator('json', syncNodesSchema, (result, c) => {
            if (!result.success)
                return c.json({ error: 'Invalid request body' }, 400);
        }),
        async (c) => {
            const sessionId = c.req.param('sessionId');
            const graphId = c.req.param('graphId');
            const { nodes } = c.req.valid('json');
            const userId = c.get('userId');

            const session = await db.session.findFirst({
                where: { id: sessionId, userId },
            });
            if (!session) {
                return c.json({ error: 'Session not found' }, 404);
            }

            // Delete existing nodes for this graph first
            await db.taskNode.deleteMany({
                where: { sessionId, graphId },
            });

            // Bulk create the new nodes
            const created = await Promise.all(
                nodes.map((node) =>
                    db.taskNode.create({
                        data: {
                            graphId,
                            sessionId,
                            labelId: node.id,
                            type: node.type,
                            description: node.description,
                            dependencies: node.dependencies,
                            status: node.status,
                            result: node.result ?? null,
                            error: node.error ?? null,
                            files: node.files ?? [],
                        },
                    }),
                ),
            );

            return c.json({ success: true, count: created.length });
        },
    )
    .put(
        '/sessions/:sessionId/graphs/:graphId/nodes/:nodeId',
        zValidator('json', updateNodeSchema, (result, c) => {
            if (!result.success)
                return c.json({ error: 'Invalid request body' }, 400);
        }),
        async (c) => {
            const sessionId = c.req.param('sessionId');
            const graphId = c.req.param('graphId');
            const nodeId = c.req.param('nodeId');
            const userId = c.get('userId');

            const session = await db.session.findFirst({
                where: { id: sessionId, userId },
            });
            if (!session) {
                return c.json({ error: 'Session not found' }, 404);
            }

            const updateData = c.req.valid('json');

            const existing = await db.taskNode.findFirst({
                where: { sessionId, graphId, labelId: nodeId },
            });

            if (!existing) {
                return c.json({ error: 'Task node not found' }, 404);
            }

            const updated = await db.taskNode.update({
                where: { id: existing.id },
                data: {
                    status: updateData.status ?? undefined,
                    result:
                        updateData.result !== undefined
                            ? updateData.result
                            : undefined,
                    error:
                        updateData.error !== undefined
                            ? updateData.error
                            : undefined,
                    description: updateData.description ?? undefined,
                    files: updateData.files ?? undefined,
                },
            });

            return c.json(updated);
        },
    )
    .get('/sessions/:sessionId/nodes', async (c) => {
        const sessionId = c.req.param('sessionId');
        const userId = c.get('userId');

        const session = await db.session.findFirst({
            where: { id: sessionId, userId },
        });
        if (!session) {
            return c.json({ error: 'Session not found' }, 404);
        }

        const nodes = await db.taskNode.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'asc' },
        });
        return c.json(nodes);
    });

export default app;
