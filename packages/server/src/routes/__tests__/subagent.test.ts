import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../../lib/polar', () => ({
    getAvailableCreditsBalance: vi.fn().mockResolvedValue(50),
    getCachedCreditsBalance: vi.fn().mockReturnValue(null),
    ingestAIUsage: vi.fn(),
}));

vi.mock('../../lib/models', () => ({
    resolveSubagentChatModel: vi.fn().mockResolvedValue({
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
        .mockImplementation((messages: unknown[]) => Promise.resolve(messages)),
    tool: vi.fn(),
    jsonSchema: vi.fn(),
}));

// Do NOT mock @nightcode/shared - we need the real modeSchema for Zod validation.
// Only mock the server-specific modules that have external dependencies.

import subagent from '../subagent';
import type { AuthenticatedEnv } from '../../middleware/require-auth';

function createSubagentApp() {
    const app = new Hono<AuthenticatedEnv>();
    app.use('*', async (c, next) => {
        c.set('userId', 'test-user-id');
        await next();
    });
    app.route('/subagent', subagent);
    return app;
}

describe('Subagent Route', () => {
    let app: Hono<AuthenticatedEnv>;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createSubagentApp();
    });

    describe('POST /subagent', () => {
        it('returns 400 for invalid request body', async () => {
            const res = await app.request('/subagent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when messages is empty', async () => {
            const res = await app.request('/subagent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [],
                    model: 'gpt-4o',
                    mode: 'PLAN',
                }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when model is missing', async () => {
            const res = await app.request('/subagent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            parts: [{ type: 'text', text: 'Research' }],
                        },
                    ],
                    mode: 'PLAN',
                }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 402 when credits are zero', async () => {
            const { getCachedCreditsBalance } =
                await import('../../lib/polar');
            vi.mocked(getCachedCreditsBalance).mockReturnValueOnce(0);
            const res = await app.request('/subagent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            parts: [{ type: 'text', text: 'Research' }],
                        },
                    ],
                    model: 'gpt-4o',
                    mode: 'PLAN',
                }),
            });
            expect(res.status).toBe(402);
        });

        it('returns streaming response on success', async () => {
            const res = await app.request('/subagent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            parts: [{ type: 'text', text: 'Research' }],
                        },
                    ],
                    model: 'gpt-4o',
                    mode: 'PLAN',
                }),
            });
            expect(res.status).toBe(200);
        });

        it('accepts optional agentId', async () => {
            const res = await app.request('/subagent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            parts: [{ type: 'text', text: 'Research' }],
                        },
                    ],
                    model: 'gpt-4o',
                    mode: 'PLAN',
                    agentId: 'researcher-1',
                }),
            });
            expect(res.status).toBe(200);
        });
    });
});
