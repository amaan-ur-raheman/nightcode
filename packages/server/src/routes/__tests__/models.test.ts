import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock the auth module before any imports to prevent top-level env var check
vi.mock('../../lib/auth', () => ({
    authenticateOAuthRequest: vi
        .fn()
        .mockResolvedValue({ userId: 'test-user' }),
}));

import models from '../models';

vi.mock('../../lib/model-fetcher', () => ({
    fetchAllModels: vi.fn().mockResolvedValue({
        models: [
            {
                id: 'test/model-1',
                displayName: 'Test Model 1',
                provider: 'openai',
                pricing: {
                    inputUsdPerMillionTokens: 2.5,
                    outputUsdPerMillionTokens: 10,
                },
            },
        ],
        providers: ['openai'],
        cached: false,
        fetchedAt: Date.now(),
    }),
    clearModelCache: vi.fn(),
}));

describe('Models Route', () => {
    let app: Hono;

    beforeEach(() => {
        vi.clearAllMocks();
        app = new Hono().route('/models', models);
    });

    describe('GET /models', () => {
        it('returns models list', async () => {
            const res = await app.request('/models');
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toHaveProperty('models');
            expect(body.models).toHaveLength(1);
            expect(body.models[0].id).toBe('test/model-1');
        });

        it('passes provider API keys from header', async () => {
            const { fetchAllModels } = await import('../../lib/model-fetcher');
            vi.mocked(fetchAllModels).mockClear();

            const keys = { openai: 'sk-test' };
            await app.request('/models', {
                headers: { 'x-provider-keys': JSON.stringify(keys) },
            });

            expect(fetchAllModels).toHaveBeenCalledWith(keys);
        });

        it('handles malformed x-provider-keys header gracefully', async () => {
            const { fetchAllModels } = await import('../../lib/model-fetcher');
            vi.mocked(fetchAllModels).mockClear();

            await app.request('/models', {
                headers: { 'x-provider-keys': 'not-valid-json' },
            });

            // Should pass undefined keys when header is invalid JSON
            expect(fetchAllModels).toHaveBeenCalledWith(undefined);
        });

        it('handles non-object x-provider-keys header', async () => {
            const { fetchAllModels } = await import('../../lib/model-fetcher');
            vi.mocked(fetchAllModels).mockClear();

            await app.request('/models', {
                headers: { 'x-provider-keys': '"just-a-string"' },
            });

            // Should pass undefined keys when header is not an object
            expect(fetchAllModels).toHaveBeenCalledWith(undefined);
        });
    });

    describe('POST /models/refresh', () => {
        it('clears cache and returns fresh models', async () => {
            const { fetchAllModels, clearModelCache } =
                await import('../../lib/model-fetcher');
            vi.mocked(fetchAllModels).mockClear();

            const res = await app.request('/models/refresh', {
                method: 'POST',
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(clearModelCache).toHaveBeenCalled();
            expect(body).toHaveProperty('models');
        });

        it('returns 429 when rate limited', async () => {
            // First refresh succeeds
            await app.request('/models/refresh', { method: 'POST' });
            // Second refresh within cooldown should be rate limited
            const res = await app.request('/models/refresh', {
                method: 'POST',
            });
            const body = await res.json();

            expect(res.status).toBe(429);
            expect(body).toHaveProperty('error');
        });
    });
});
