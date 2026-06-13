import { z } from 'zod';
import { Hono } from 'hono';
import { generateText } from 'ai';

import { db } from '@nightcode/database/client';
import { zValidator } from '@hono/zod-validator';

import type { AuthenticatedEnv } from '../middleware/require-auth';
import { requireCreditsBalance } from '../middleware/require-credits-balance';
import type { ConversationBranch } from '@nightcode/shared';
import { resolveChatModel } from '../lib/models';

const createSessionSchema = z.object({
    title: z.string(),
});

const createSessionValidator = zValidator(
    'json',
    createSessionSchema,
    (result, c) => {
        if (!result.success) {
            return c.json({ error: 'Invalid request body' }, 400);
        }
    },
);

const updateSessionSchema = z.object({
    title: z.string(),
});

const updateSessionValidator = zValidator(
    'json',
    updateSessionSchema,
    (result, c) => {
        if (!result.success) {
            return c.json({ error: 'Invalid request body' }, 400);
        }
    },
);

const app = new Hono<AuthenticatedEnv>()
    .get('/', async (c) => {
        const userId = c.get('userId');
        const limit = Math.min(Number(c.req.query('limit')) || 100, 200);
        const cursor = c.req.query('cursor');

        try {
            const sessions = await db.session.findMany({
                where: {
                    userId,
                    ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: {
                    id: true,
                    title: true,
                    createdAt: true,
                },
            });

            return c.json(sessions);
        } catch (err) {
            console.error('Failed to list sessions:', err);
            return c.json({ error: 'Failed to fetch sessions' }, 500);
        }
    })
    .get('/:id', async (c) => {
        const id = c.req.param('id');
        const userId = c.get('userId');

        try {
            const session = await db.session.findUnique({
                where: { id, userId },
            });
            if (!session) {
                return c.json({ error: 'Session not found' }, 404);
            }

            return c.json(session);
        } catch (err) {
            console.error('Failed to fetch session:', err);
            return c.json({ error: 'Failed to fetch session' }, 500);
        }
    })
    .post('/', requireCreditsBalance, createSessionValidator, async (c) => {
        const userId = c.get('userId');
        const data = c.req.valid('json');

        try {
            const session = await db.session.create({
                data: {
                    ...data,
                    userId,
                },
            });

            return c.json(session, 201);
        } catch (err) {
            console.error('Failed to create session:', err);
            return c.json({ error: 'Failed to create session' }, 500);
        }
    })
    .patch('/:id', updateSessionValidator, async (c) => {
        const id = c.req.param('id');
        const userId = c.get('userId');
        const { title } = c.req.valid('json');

        try {
            const session = await db.session.update({
                where: { id, userId },
                data: { title },
                select: { id: true, title: true },
            });

            return c.json(session);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'P2025') {
                return c.json({ error: 'Session not found' }, 404);
            }
            throw err;
        }
    })

    // ─── Branch routes ──────────────────────────────────────────────────────

    .get('/:id/branches', async (c) => {
        const id = c.req.param('id');
        const userId = c.get('userId');

        try {
            const session = await db.session.findUnique({
                where: { id, userId },
                select: { branches: true, activeBranchId: true },
            });
            if (!session) {
                return c.json({ error: 'Session not found' }, 404);
            }

            return c.json({
                branches:
                    (session.branches as unknown as ConversationBranch[]) ?? [],
                activeBranchId: (session.activeBranchId as string) ?? 'main',
            });
        } catch (err) {
            console.error('Failed to fetch branches:', err);
            return c.json({ error: 'Failed to fetch branches' }, 500);
        }
    })

    .post(
        '/:id/branches',
        zValidator(
            'json',
            z.object({
                parentMessageIndex: z.number().int().min(0),
                name: z.string().optional(),
            }),
            (result, c) => {
                if (!result.success) {
                    return c.json({ error: 'Invalid request body' }, 400);
                }
            },
        ),
        async (c) => {
            const id = c.req.param('id');
            const userId = c.get('userId');
            const { parentMessageIndex, name } = c.req.valid('json');

            try {
                const session = await db.session.findUnique({
                    where: { id, userId },
                    select: { branches: true, activeBranchId: true },
                });
                if (!session) {
                    return c.json({ error: 'Session not found' }, 404);
                }

                const branches =
                    (session.branches as unknown as ConversationBranch[]) ?? [];
                const autoName = `Branch ${branches.length + 1}`;
                const newBranch: ConversationBranch = {
                    id: crypto.randomUUID(),
                    parentBranchId:
                        (session.activeBranchId as string) ?? 'main',
                    parentMessageIndex,
                    name: name ?? autoName,
                    createdAt: new Date().toISOString(),
                };

                const updatedBranches = [...branches, newBranch];

                await db.session.update({
                    where: { id, userId },
                    data: {
                        branches: updatedBranches as any,
                        activeBranchId: newBranch.id,
                    },
                });

                return c.json(newBranch, 201);
            } catch (err) {
                console.error('Failed to create branch:', err);
                return c.json({ error: 'Failed to create branch' }, 500);
            }
        },
    )

    .put(
        '/:id/active-branch',
        zValidator(
            'json',
            z.object({
                branchId: z.string(),
            }),
            (result, c) => {
                if (!result.success) {
                    return c.json({ error: 'Invalid request body' }, 400);
                }
            },
        ),
        async (c) => {
            const id = c.req.param('id');
            const userId = c.get('userId');
            const { branchId } = c.req.valid('json');

            try {
                const session = await db.session.findUnique({
                    where: { id, userId },
                    select: { branches: true },
                });
                if (!session) {
                    return c.json({ error: 'Session not found' }, 404);
                }

                if (branchId !== 'main') {
                    const branches =
                        (session.branches as unknown as ConversationBranch[]) ??
                        [];
                    const exists = branches.some((b) => b.id === branchId);
                    if (!exists) {
                        return c.json({ error: 'Branch not found' }, 404);
                    }
                }

                await db.session.update({
                    where: { id, userId },
                    data: { activeBranchId: branchId },
                });

                return c.json({ branchId });
            } catch (err) {
                console.error('Failed to update active branch:', err);
                return c.json({ error: 'Failed to update active branch' }, 500);
            }
        },
    )

    .delete('/:id/branches/:branchId', async (c) => {
        const id = c.req.param('id');
        const branchId = c.req.param('branchId');
        const userId = c.get('userId');

        if (branchId === 'main') {
            return c.json({ error: 'Cannot delete the main branch' }, 400);
        }

        try {
            const session = await db.session.findUnique({
                where: { id, userId },
                select: { branches: true, activeBranchId: true },
            });
            if (!session) {
                return c.json({ error: 'Session not found' }, 404);
            }

            const branches =
                (session.branches as unknown as ConversationBranch[]) ?? [];
            const filtered = branches.filter((b) => b.id !== branchId);

            if (filtered.length === branches.length) {
                return c.json({ error: 'Branch not found' }, 404);
            }

            const newActiveBranch =
                (session.activeBranchId as string) === branchId
                    ? 'main'
                    : session.activeBranchId;

            await db.session.update({
                where: { id, userId },
                data: {
                    branches: filtered as any,
                    activeBranchId: newActiveBranch,
                },
            });

            return c.json({ deleted: branchId });
        } catch (err) {
            console.error('Failed to delete branch:', err);
            return c.json({ error: 'Failed to delete branch' }, 500);
        }
    })
    .post(
        '/:id/commit-message',
        zValidator(
            'json',
            z.object({
                diff: z.string(),
                model: z.string(),
            }),
            (result, c) => {
                if (!result.success) {
                    return c.json({ error: 'Invalid request body' }, 400);
                }
            },
        ),
        async (c) => {
            const { diff, model } = c.req.valid('json');
            const providerApiKey = c.req.header('x-provider-key') ?? undefined;

            try {
                const resolved = await resolveChatModel(model, providerApiKey);
                const systemPrompt =
                    'You are an expert developer. Write a clear, concise conventional commit message based on the provided git diff. Do NOT wrap the message in markdown code blocks or quotes. Respond with ONLY the commit message text. Keep the first line short (under 50 characters) and summarize key changes in bullets if necessary.';
                const prompt = `Here is the git diff:\n\n${diff}`;

                const { text } = await generateText({
                    model: resolved.model,
                    system: systemPrompt,
                    prompt: prompt,
                    providerOptions: resolved.providerOptions,
                    abortSignal: AbortSignal.timeout(30000),
                });

                return c.json({ commitMessage: text.trim() });
            } catch (err) {
                return c.json(
                    {
                        error:
                            err instanceof Error
                                ? err.message
                                : 'Failed to generate commit message',
                    },
                    500,
                );
            }
        },
    );

export default app;
