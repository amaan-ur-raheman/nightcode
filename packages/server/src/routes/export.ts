import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '@nightcode/database/client';
import { zValidator } from '@hono/zod-validator';

import type { AuthenticatedEnv } from '../middleware/require-auth';

const importSessionSchema = z.object({
    title: z.string().min(1).max(200),
    messages: z.any(),
    branches: z.any().optional(),
    activeBranchId: z.string().optional(),
});

const importSessionValidator = zValidator(
    'json',
    importSessionSchema,
    (result, c) => {
        if (!result.success) {
            return c.json({ error: 'Invalid import data' }, 400);
        }
    },
);

const app = new Hono<AuthenticatedEnv>()
    .get('/session/:id', async (c) => {
        const id = c.req.param('id');
        const userId = c.get('userId');

        const session = await db.session.findUnique({
            where: { id, userId },
            select: {
                id: true,
                title: true,
                messages: true,
                branches: true,
                activeBranchId: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!session) {
            return c.json({ error: 'Session not found' }, 404);
        }

        return c.json({
            exportedAt: new Date().toISOString(),
            version: 1,
            session,
        });
    })
    .get('/all', async (c) => {
        const userId = c.get('userId');

        const sessions = await db.session.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                messages: true,
                branches: true,
                activeBranchId: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return c.json({
            exportedAt: new Date().toISOString(),
            version: 1,
            sessions,
        });
    })
    .post('/import', importSessionValidator, async (c) => {
        const userId = c.get('userId');
        const data = c.req.valid('json');

        const session = await db.session.create({
            data: {
                userId,
                title: data.title,
                messages: data.messages ?? [],
                branches: data.branches ?? [],
                activeBranchId: data.activeBranchId ?? 'main',
            },
            select: {
                id: true,
                title: true,
                createdAt: true,
            },
        });

        return c.json(session, 201);
    });

export default app;
