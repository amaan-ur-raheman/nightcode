import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const { mockDb } = vi.hoisted(() => ({
    mockDb: {
        session: {
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
        },
    },
}));

vi.mock('@nightcode/database/client', () => ({ db: mockDb }));

vi.mock('../../lib/polar', () => ({
    getAvailableCreditsBalance: vi.fn().mockResolvedValue(50),
}));

const mockSession = {
    id: 'session-1',
    title: 'Test Session',
    userId: 'test-user-id',
    messages: [],
    branches: [],
    activeBranchId: 'main',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
};

import sessions from '../sessions';
import type { AuthenticatedEnv } from '../../middleware/require-auth';

function createSessionsApp() {
    const app = new Hono<AuthenticatedEnv>();
    app.use('*', async (c, next) => {
        c.set('userId', 'test-user-id');
        await next();
    });
    app.route('/sessions', sessions);
    return app;
}

describe('Sessions Route', () => {
    let app: Hono<AuthenticatedEnv>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDb.session.findMany.mockResolvedValue([mockSession]);
        mockDb.session.findUnique.mockResolvedValue(mockSession);
        mockDb.session.create.mockResolvedValue(mockSession);
        mockDb.session.update.mockResolvedValue(mockSession);
        app = createSessionsApp();
    });

    describe('GET /sessions', () => {
        it('returns list of sessions', async () => {
            const res = await app.request('/sessions');
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(Array.isArray(body)).toBe(true);
            expect(body).toHaveLength(1);
        });

        it('respects limit query param', async () => {
            await app.request('/sessions?limit=5');
            expect(mockDb.session.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 5 }),
            );
        });

        it('caps limit at 200', async () => {
            await app.request('/sessions?limit=500');
            expect(mockDb.session.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 200 }),
            );
        });
    });

    describe('GET /sessions/:id', () => {
        it('returns session by id', async () => {
            const res = await app.request('/sessions/session-1');
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(body.id).toBe('session-1');
        });

        it('returns 404 for non-existent session', async () => {
            mockDb.session.findUnique.mockResolvedValue(null);
            const res = await app.request('/sessions/nonexistent');
            const body = await res.json();
            expect(res.status).toBe(404);
            expect(body).toHaveProperty('error');
        });
    });

    describe('POST /sessions', () => {
        it('creates a new session', async () => {
            const res = await app.request('/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'New Session' }),
            });
            expect(res.status).toBe(201);
            expect(mockDb.session.create).toHaveBeenCalled();
        });

        it('returns 400 for invalid body', async () => {
            const res = await app.request('/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });
    });

    describe('PATCH /sessions/:id', () => {
        it('updates session title', async () => {
            const res = await app.request('/sessions/session-1', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Updated Title' }),
            });
            expect(res.status).toBe(200);
            expect(mockDb.session.update).toHaveBeenCalled();
        });

        it('returns 404 when session not found', async () => {
            const error = new Error('Not found') as Error & { code: string };
            error.code = 'P2025';
            mockDb.session.update.mockRejectedValueOnce(error);
            const res = await app.request('/sessions/nonexistent', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Updated' }),
            });
            expect(res.status).toBe(404);
        });
    });

    describe('GET /sessions/:id/branches', () => {
        it('returns branches for session', async () => {
            const res = await app.request('/sessions/session-1/branches');
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(body).toHaveProperty('branches');
            expect(body).toHaveProperty('activeBranchId');
        });

        it('returns 404 for non-existent session', async () => {
            mockDb.session.findUnique.mockResolvedValue(null);
            const res = await app.request('/sessions/nonexistent/branches');
            expect(res.status).toBe(404);
        });
    });

    describe('POST /sessions/:id/branches', () => {
        it('creates a new branch', async () => {
            const res = await app.request('/sessions/session-1/branches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentMessageIndex: 0 }),
            });
            expect(res.status).toBe(201);
            expect(mockDb.session.update).toHaveBeenCalled();
        });

        it('returns 400 for invalid body', async () => {
            const res = await app.request('/sessions/session-1/branches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });
    });

    describe('PUT /sessions/:id/active-branch', () => {
        it('updates active branch', async () => {
            const res = await app.request('/sessions/session-1/active-branch', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branchId: 'main' }),
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.branchId).toBe('main');
        });

        it('returns 404 for non-existent branch', async () => {
            mockDb.session.findUnique.mockResolvedValueOnce({
                ...mockSession,
                branches: [],
            });
            const res = await app.request('/sessions/session-1/active-branch', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branchId: 'nonexistent' }),
            });
            expect(res.status).toBe(404);
        });
    });

    describe('GET /sessions (cursor pagination)', () => {
        it('passes cursor to findMany when provided', async () => {
            await app.request('/sessions?cursor=2024-01-01T00:00:00.000Z');
            expect(mockDb.session.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        createdAt: { lt: expect.any(Date) },
                    }),
                }),
            );
        });
    });

    describe('DELETE /sessions/:id/branches/:branchId', () => {
        it('returns 400 when trying to delete main branch', async () => {
            const res = await app.request('/sessions/session-1/branches/main', {
                method: 'DELETE',
            });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error).toContain('main branch');
        });

        it('returns 404 when branch not found', async () => {
            mockDb.session.findUnique.mockResolvedValueOnce({
                ...mockSession,
                branches: [],
            });
            const res = await app.request(
                '/sessions/session-1/branches/nonexistent',
                { method: 'DELETE' },
            );
            expect(res.status).toBe(404);
        });

        it('deletes a non-main branch and resets active branch to main', async () => {
            const branchId = 'branch-abc';
            mockDb.session.findUnique.mockResolvedValueOnce({
                ...mockSession,
                branches: [
                    {
                        id: branchId,
                        name: 'Feature',
                        parentBranchId: 'main',
                        parentMessageIndex: 0,
                        createdAt: '2024-01-01',
                    },
                ],
                activeBranchId: branchId,
            });
            const res = await app.request(
                `/sessions/session-1/branches/${branchId}`,
                { method: 'DELETE' },
            );
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.deleted).toBe(branchId);
            expect(mockDb.session.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ activeBranchId: 'main' }),
                }),
            );
        });

        it('returns session not found when session does not exist', async () => {
            mockDb.session.findUnique.mockResolvedValueOnce(null);
            const res = await app.request(
                '/sessions/nonexistent/branches/branch-1',
                { method: 'DELETE' },
            );
            expect(res.status).toBe(404);
        });
    });
});
