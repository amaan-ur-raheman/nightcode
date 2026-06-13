import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Server Models', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('isSupportedChatModel returns true for known models', async () => {
        const { isSupportedChatModel } = await import('../models');
        expect(isSupportedChatModel('gpt-4o')).toBe(true);
        expect(isSupportedChatModel('claude-sonnet-4-20250514')).toBe(true);
        expect(
            isSupportedChatModel('nvidia/deepseek-ai/deepseek-v4-flash'),
        ).toBe(true);
    });

    it('isSupportedChatModel returns false for unknown models', async () => {
        const { isSupportedChatModel } = await import('../models');
        expect(isSupportedChatModel('unknown-model')).toBe(false);
    });

    it('resolveChatModel throws for unsupported models', async () => {
        const { resolveChatModel } = await import('../models');
        await expect(resolveChatModel('unknown-model')).rejects.toThrow();
    });

    it('resolveSubagentChatModel throws for unsupported models', async () => {
        const { resolveSubagentChatModel } = await import('../models');
        await expect(
            resolveSubagentChatModel('unknown-model'),
        ).rejects.toThrow();
    });

    it('resolves local models correctly', async () => {
        const { resolveChatModel } = await import('../models');
        const { registerLocalModel } = await import('@nightcode/shared');

        registerLocalModel('local/llama3:latest');

        const resolved = await resolveChatModel('local/llama3:latest');
        expect(resolved.provider).toBe('local');
        expect(resolved.modelId).toBe('local/llama3:latest');
        expect(resolved.model).toBeDefined();
    });
});
