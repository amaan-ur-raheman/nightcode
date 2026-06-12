import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../../lib/polar', () => ({
    getAvailableCreditsBalance: vi.fn().mockResolvedValue(50),
    ingestAIUsage: vi.fn(),
}));

vi.mock('../../lib/models', () => ({
    resolveChatModel: vi.fn().mockResolvedValue({
        model: {},
        provider: 'openai',
        modelId: 'gpt-4o',
        providerOptions: {},
    }),
}));

const mockGenerateText = vi.hoisted(() =>
    vi.fn().mockResolvedValue({
        text: '[{"id":"task-1","type":"coder","description":"Implement feature","dependencies":[],"files":[],"mode":"BUILD"}]',
        usage: { inputTokens: 100, outputTokens: 50 },
    }),
);

vi.mock('../../lib/fallback', () => ({
    withFallback: vi.fn().mockImplementation(async (fn: Function) => {
        const result = await fn('gpt-4o');
        return { result, modelUsed: 'gpt-4o', fallbackTriggered: false };
    }),
}));

// Mock ai module completely - no importOriginal needed
vi.mock('ai', () => ({
    generateText: mockGenerateText,
    streamText: vi.fn(),
    validateUIMessages: vi
        .fn()
        .mockImplementation(({ messages }) => Promise.resolve(messages)),
    convertToModelMessages: vi
        .fn()
        .mockImplementation((messages) => Promise.resolve(messages)),
    tool: vi.fn(),
    jsonSchema: vi.fn(),
}));

import orchestrator from '../orchestrator';
import type { AuthenticatedEnv } from '../../middleware/require-auth';

function createOrchestratorApp() {
    const app = new Hono<AuthenticatedEnv>();
    app.use('*', async (c, next) => {
        c.set('userId', 'test-user-id');
        await next();
    });
    app.route('/orchestrator', orchestrator);
    return app;
}

describe('Orchestrator Route', () => {
    let app: Hono<AuthenticatedEnv>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockGenerateText.mockResolvedValue({
            text: '[{"id":"task-1","type":"coder","description":"Implement feature","dependencies":[],"files":[],"mode":"BUILD"}]',
            usage: { inputTokens: 100, outputTokens: 50 },
        });
        app = createOrchestratorApp();
    });

    describe('POST /orchestrator/decompose', () => {
        it('returns 400 for invalid request body', async () => {
            const res = await app.request('/orchestrator/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when messages is empty', async () => {
            const res = await app.request('/orchestrator/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [],
                    model: 'gpt-4o',
                    mode: 'BUILD',
                }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when model is missing', async () => {
            const res = await app.request('/orchestrator/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: 'Build' }],
                    mode: 'BUILD',
                }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 402 when credits are zero', async () => {
            const { getAvailableCreditsBalance } =
                await import('../../lib/polar');
            vi.mocked(getAvailableCreditsBalance).mockResolvedValueOnce(0);
            const res = await app.request('/orchestrator/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: 'Build' }],
                    model: 'gpt-4o',
                    mode: 'BUILD',
                }),
            });
            expect(res.status).toBe(402);
        });

        it('returns decomposition result on success', async () => {
            const res = await app.request('/orchestrator/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: 'Build a feature' }],
                    model: 'gpt-4o',
                    mode: 'BUILD',
                    strategy: 'balanced',
                }),
            });
            expect(res.status).toBe(200);
            const body = await res.text();
            expect(body).toContain('task-1');
        });

        it('defaults strategy to balanced', async () => {
            const res = await app.request('/orchestrator/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: 'Build' }],
                    model: 'gpt-4o',
                    mode: 'BUILD',
                }),
            });
            expect(res.status).toBe(200);
        });
    });
});
