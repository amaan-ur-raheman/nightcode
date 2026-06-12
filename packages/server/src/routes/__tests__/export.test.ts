import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockDb = vi.hoisted(() => ({
    session: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({
            id: 'new-session',
            title: 'Imported',
            createdAt: new Date(),
        }),
    },
}));

vi.mock('@nightcode/database/client', () => ({ db: mockDb }));

const mockSession = {
    id: 'session-1',
    title: 'Test Session',
    messages: [
        { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ],
    branches: [],
    activeBranchId: 'main',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
};

import exportRoutes from '../export';
import type { AuthenticatedEnv } from '../../middleware/require-auth';

function createExportApp() {
    const app = new Hono<AuthenticatedEnv>();
    app.use('*', async (c, next) => {
        c.set('userId', 'test-user-id');
        await next();
    });
    app.route('/export', exportRoutes);
    return app;
}

describe('Export Route', () => {
    let app: Hono<AuthenticatedEnv>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDb.session.findUnique.mockResolvedValue(mockSession);
        mockDb.session.findMany.mockResolvedValue([mockSession]);
        mockDb.session.create.mockResolvedValue({
            id: 'new-session',
            title: 'Imported',
            createdAt: new Date(),
        });
        app = createExportApp();
    });

    describe('GET /export/session/:id', () => {
        it('exports a single session with metadata', async () => {
            const res = await app.request('/export/session/session-1');
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(body).toHaveProperty('exportedAt');
            expect(body).toHaveProperty('version', 1);
            expect(body).toHaveProperty('session');
            expect(body.session.id).toBe('session-1');
        });

        it('returns 404 for non-existent session', async () => {
            mockDb.session.findUnique.mockResolvedValue(null);
            const res = await app.request('/export/session/nonexistent');
            const body = await res.json();
            expect(res.status).toBe(404);
            expect(body).toHaveProperty('error');
        });
    });

    describe('GET /export/all', () => {
        it('exports all sessions', async () => {
            const res = await app.request('/export/all');
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(body).toHaveProperty('exportedAt');
            expect(body).toHaveProperty('version', 1);
            expect(body).toHaveProperty('sessions');
            expect(body.sessions).toHaveLength(1);
        });
    });

    describe('POST /export/import', () => {
        it('imports a session', async () => {
            const res = await app.request('/export/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Imported Session',
                    messages: [],
                }),
            });
            expect(res.status).toBe(201);
            expect(mockDb.session.create).toHaveBeenCalled();
            const body = await res.json();
            expect(body).toHaveProperty('id');
            expect(body).toHaveProperty('title');
        });

        it('returns 400 for invalid import data', async () => {
            const res = await app.request('/export/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 for empty title', async () => {
            const res = await app.request('/export/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: '', messages: [] }),
            });
            expect(res.status).toBe(400);
        });
    });
});
