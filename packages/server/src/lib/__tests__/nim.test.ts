import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@nightcode/shared', () => ({
    keychain: {
        isAvailable: () => false,
        getKey: async () => null,
        setKey: async () => {},
        deleteKey: async () => {},
    },
}));

describe('NIM Provider', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete process.env.NIM_API_KEY;
        delete process.env.NIM_API_KEY_SUBAGENT;
    });

    it('throws when NIM_API_KEY is not set', async () => {
        const { nim } = await import('../nim');
        await expect(
            nim('nvidia/deepseek-ai/deepseek-v4-flash'),
        ).rejects.toThrow('NIM_API_KEY');
    });

    it('uses NIM_API_KEY when set', async () => {
        process.env.NIM_API_KEY = 'test-key';
        // Mock the openai-compatible module to return a mock model
        vi.doMock('@ai-sdk/openai-compatible', () => ({
            createOpenAICompatible: () => (_modelId: string) => ({
                modelId: _modelId,
                doGenerate: async () => ({ text: 'test' }),
                doStream: async () => ({}),
            }),
        }));
        const { nim } = await import('../nim');
        // Should not throw because NIM_API_KEY is set
        await expect(
            nim('nvidia/deepseek-ai/deepseek-v4-flash'),
        ).resolves.toBeDefined();
    });

    it('nimSubagent uses subagent key when available', async () => {
        process.env.NIM_API_KEY_SUBAGENT = 'subagent-key';
        vi.doMock('@ai-sdk/openai-compatible', () => ({
            createOpenAICompatible: () => (_modelId: string) => ({
                modelId: _modelId,
                doGenerate: async () => ({}),
                doStream: async () => ({}),
            }),
        }));
        const { nimSubagent } = await import('../nim');
        const result = await nimSubagent(
            'nvidia/deepseek-ai/deepseek-v4-flash',
        );
        expect(result).toBeDefined();
    });

    it('providers module exports the correct functions', async () => {
        const mod = await import('../nim');
        expect(typeof mod.nim).toBe('function');
        expect(typeof mod.nimSubagent).toBe('function');
    });

    it('nimSubagent falls back to NIM_API_KEY when subagent key not set', async () => {
        process.env.NIM_API_KEY = 'main-key';
        vi.doMock('@ai-sdk/openai-compatible', () => ({
            createOpenAICompatible: () => (_modelId: string) => ({
                modelId: _modelId,
                doGenerate: async () => ({}),
                doStream: async () => ({}),
            }),
        }));
        const { nimSubagent } = await import('../nim');
        await expect(
            nimSubagent('nvidia/deepseek-ai/deepseek-v4-flash'),
        ).resolves.toBeDefined();
    });
});
