import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const { mockDb, mockGetCachedCreditsBalance, mockGetAvailableCreditsBalance } =
    vi.hoisted(() => ({
        mockDb: {
            session: {
                findUnique: vi.fn().mockResolvedValue(null),
                update: vi.fn().mockResolvedValue(null),
            },
        },
        mockGetCachedCreditsBalance: vi.fn().mockReturnValue(null),
        mockGetAvailableCreditsBalance: vi.fn().mockResolvedValue(50),
    }));

vi.mock('@nightcode/database/client', () => ({ db: mockDb }));

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

vi.mock('../../lib/polar', () => ({
    ingestAIUsage: vi.fn(),
    getAvailableCreditsBalance: mockGetAvailableCreditsBalance,
    getCachedCreditsBalance: mockGetCachedCreditsBalance,
}));

vi.mock('../../lib/models', () => ({
    resolveChatModel: vi.fn().mockResolvedValue({
        model: {},
        provider: 'openai',
        modelId: 'gpt-4o',
        providerOptions: {},
    }),
}));

vi.mock('../../lib/fallback', () => ({
    withFallback: vi.fn().mockImplementation(async (fn: Function) => {
        const result = await fn('gpt-4o');
        return { result, modelUsed: 'gpt-4o', fallbackTriggered: false };
    }),
}));

vi.mock('../../lib/generate-session-title', () => ({
    generateSessionTitle: vi.fn().mockResolvedValue('Generated Title'),
}));

// Mock ai module completely - no importOriginal needed
vi.mock('ai', () => ({
    streamText: vi.fn().mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
            new Response('streaming response', {
                headers: { 'Content-Type': 'text/plain' },
            }),
        ),
    }),
    validateUIMessages: vi
        .fn()
        .mockImplementation(({ messages }) => Promise.resolve(messages)),
    convertToModelMessages: vi
        .fn()
        .mockImplementation((messages) => Promise.resolve(messages)),
    tool: vi.fn(),
    jsonSchema: vi.fn(),
}));

import chat from '../chat';
import type { AuthenticatedEnv } from '../../middleware/require-auth';

function createChatApp() {
    const app = new Hono<AuthenticatedEnv>();
    app.use('*', async (c, next) => {
        c.set('userId', 'test-user-id');
        await next();
    });
    app.route('/chat', chat);
    return app;
}

describe('Chat Route', () => {
    let app: Hono<AuthenticatedEnv>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDb.session.findUnique.mockResolvedValue(mockSession);
        mockDb.session.update.mockResolvedValue(mockSession);
        // Re-setup polar mocks that clearAllMocks() resets
        mockGetCachedCreditsBalance.mockReturnValue(null);
        mockGetAvailableCreditsBalance.mockResolvedValue(50);
        app = createChatApp();
    });

    describe('POST /chat', () => {
        it('returns 400 for invalid request body', async () => {
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body).toHaveProperty('error');
        });

        it('returns 400 when messages array is empty', async () => {
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'session-1',
                    messages: [],
                    mode: 'PLAN',
                    model: 'gpt-4o',
                }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when model is missing', async () => {
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'session-1',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            parts: [{ type: 'text', text: 'hello' }],
                        },
                    ],
                    mode: 'PLAN',
                }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 when session not found', async () => {
            mockDb.session.findUnique.mockResolvedValue(null);
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'nonexistent',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            parts: [{ type: 'text', text: 'hello' }],
                        },
                    ],
                    mode: 'PLAN',
                    model: 'gpt-4o',
                }),
            });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body).toHaveProperty('error', 'Session not found');
        });

        it('returns 402 when credits are zero (cached)', async () => {
            const { getCachedCreditsBalance } = await import('../../lib/polar');
            vi.mocked(getCachedCreditsBalance).mockReturnValue(0);
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'session-1',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            parts: [{ type: 'text', text: 'hello' }],
                        },
                    ],
                    mode: 'PLAN',
                    model: 'gpt-4o',
                }),
            });
            expect(res.status).toBe(402);
            const body = await res.json();
            expect(body.error).toContain('No credits');
        });

        it('returns streaming response on success', async () => {
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'session-1',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            parts: [{ type: 'text', text: 'hello' }],
                        },
                    ],
                    mode: 'PLAN',
                    model: 'gpt-4o',
                }),
            });
            expect(res.status).toBe(200);
        });

        it('calls resolveChatModel with the correct model', async () => {
            const { resolveChatModel } = await import('../../lib/models');
            vi.mocked(resolveChatModel).mockClear();

            await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'session-1',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            parts: [{ type: 'text', text: 'hello' }],
                        },
                    ],
                    mode: 'BUILD',
                    model: 'gpt-4o',
                }),
            });
            expect(resolveChatModel).toHaveBeenCalledWith('gpt-4o', undefined);
        });

        it('skips credits check when cache is null (fire-and-forget)', async () => {
            const { getCachedCreditsBalance } = await import('../../lib/polar');
            vi.mocked(getCachedCreditsBalance).mockReturnValue(null);
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'session-1',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            parts: [{ type: 'text', text: 'hello' }],
                        },
                    ],
                    mode: 'PLAN',
                    model: 'gpt-4o',
                }),
            });
            // Should proceed to stream even with null cache
            expect(res.status).toBe(200);
        });

        it('passes provider API key from header', async () => {
            const { resolveChatModel } = await import('../../lib/models');
            vi.mocked(resolveChatModel).mockClear();

            await app.request('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-provider-key': 'sk-custom-key',
                },
                body: JSON.stringify({
                    id: 'session-1',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            parts: [{ type: 'text', text: 'hello' }],
                        },
                    ],
                    mode: 'PLAN',
                    model: 'gpt-4o',
                }),
            });

            expect(resolveChatModel).toHaveBeenCalledWith(
                'gpt-4o',
                'sk-custom-key',
            );
        });
    });
});
