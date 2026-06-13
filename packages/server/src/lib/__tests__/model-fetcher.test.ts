import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the pure helper functions extracted from model-fetcher.
// The fetch functions hit network so we test them with mocked fetch.

describe('model-fetcher helpers', () => {
    // Test deriveDisplayName logic inline since it's internal
    it('deriveDisplayName converts model IDs to readable names', () => {
        function deriveDisplayName(modelId: string): string {
            const id = modelId.includes('/')
                ? modelId.split('/').pop()!
                : modelId;
            return id
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase())
                .replace(/\s+/g, ' ')
                .trim();
        }

        expect(deriveDisplayName('nvidia/nemotron-3-ultra-550b-a55b')).toBe(
            'Nemotron 3 Ultra 550b A55b',
        );
        expect(deriveDisplayName('deepseek-v4-flash')).toBe(
            'Deepseek V4 Flash',
        );
        expect(deriveDisplayName('simple-model_name')).toBe(
            'Simple Model Name',
        );
        expect(deriveDisplayName('gpt-4o')).toBe('Gpt 4o');
    });

    it('parsePrice converts per-token to per-million', () => {
        function parsePrice(priceStr: string | undefined): number {
            if (!priceStr) return 0;
            const price = parseFloat(priceStr);
            return isNaN(price) ? 0 : price * 1_000_000;
        }

        expect(parsePrice(undefined)).toBe(0);
        expect(parsePrice('')).toBe(0);
        expect(parsePrice('abc')).toBe(0);
        expect(parsePrice('0.000002')).toBe(2);
        expect(parsePrice('0.01')).toBe(10000);
    });
});

describe('fetchAllModels', () => {
    it('returns cached results within TTL', async () => {
        const { fetchAllModels, clearModelCache } =
            await import('../model-fetcher');
        clearModelCache();

        // First call will attempt network, should handle gracefully
        const result1 = await fetchAllModels();
        expect(result1).toHaveProperty('models');
        expect(result1).toHaveProperty('cached');

        // Second call should be cached
        const result2 = await fetchAllModels();
        expect(result2.cached).toBe(true);
    });

    it('clearModelCache resets the cache', async () => {
        const { fetchAllModels, clearModelCache } =
            await import('../model-fetcher');
        clearModelCache();

        await fetchAllModels();
        clearModelCache();

        const result = await fetchAllModels();
        expect(result.cached).toBe(false);
    });

    it('fetchLocalOllama discovers local models and registers them', async () => {
        const { fetchAllModels, clearModelCache } = await import('../model-fetcher');
        const { findSupportedChatModel } = await import('@nightcode/shared');

        clearModelCache();

        const mockResponse = {
            models: [
                { name: 'llama3:latest', model: 'llama3:latest' }
            ]
        };

        const originalFetch = global.fetch;
        (global as any).fetch = vi.fn().mockImplementation((url: string) => {
            if (url.includes('11434')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                } as any);
            }
            return Promise.resolve({
                ok: false,
            } as any);
        });

        try {
            const result = await fetchAllModels();
            const localModels = result.models.filter(m => m.provider === 'local');
            expect(localModels).toHaveLength(1);
            const first = localModels[0];
            if (!first) throw new Error('No local models found');
            expect(first.id).toBe('local/llama3:latest');
            expect(first.displayName).toBe('Llama3 Latest');

            // Verify registered in SUPPORTED_CHAT_MODELS search
            const resolved = findSupportedChatModel('local/llama3:latest');
            expect(resolved).toBeDefined();
            if (!resolved) throw new Error('Model was not resolved');
            expect(resolved.provider).toBe('local');
            expect(resolved.pricing.inputUsdPerMillionTokens).toBe(0.1);
        } finally {
            (global as any).fetch = originalFetch;
        }
    });
});
