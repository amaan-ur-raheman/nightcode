import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../request-queue', () => ({
    requestQueue: {
        enqueue: async (fn: Function) => fn(),
    },
}));

vi.mock('../zen', () => ({
    zen: async () => ({}),
    isZenModel: () => false,
    isZenModelId: () => false,
}));

describe('Server Providers', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('getProviderName returns nim for unknown models', async () => {
        const { getProviderName } = await import('../providers');
        const name = getProviderName('unknown-model');
        expect(name).toBe('nim');
    });

    it('getProviderName returns correct provider for known models', async () => {
        const { getProviderName } = await import('../providers');
        expect(getProviderName('nvidia/deepseek-ai/deepseek-v4-flash')).toBe(
            'nim',
        );
    });

    it('getProviderClient throws for unknown model without API key', async () => {
        const { getProviderClient } = await import('../providers');
        await expect(getProviderClient('unknown-model')).rejects.toThrow();
    });

    it('getProviderClient throws for model without API key even if provider matches', async () => {
        const { getProviderClient } = await import('../providers');
        await expect(
            getProviderClient('nvidia/deepseek-ai/deepseek-v4-flash'),
        ).rejects.toThrow();
    });

    it('getProviderClient succeeds when API key is passed', async () => {
        const { getProviderClient } = await import('../providers');
        const client = await getProviderClient(
            'nvidia/deepseek-ai/deepseek-v4-flash',
            'test-key',
        );
        expect(client).toBeDefined();
    });

    it('isModelAvailable returns true for known model regardless of key', async () => {
        const { isModelAvailable } = await import('../providers');
        const available = await isModelAvailable(
            'nvidia/deepseek-ai/deepseek-v4-flash',
        );
        expect(available).toBe(true);
    });

    it('isModelAvailable returns false for unknown model', async () => {
        const { isModelAvailable } = await import('../providers');
        const available = await isModelAvailable('nonexistent-model');
        expect(available).toBe(false);
    });
});
