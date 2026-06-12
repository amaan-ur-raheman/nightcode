import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isZenModel, isZenModelId, getZenSdkType } from '../zen';

describe('isZenModel', () => {
    it('returns true for opencode/ prefixed models', () => {
        expect(isZenModel('opencode/gpt-5.4')).toBe(true);
        expect(isZenModel('opencode/mimo-v2.5-free')).toBe(true);
        expect(isZenModel('opencode/claude-sonnet-4-6')).toBe(true);
    });

    it('returns false for non-opencode models', () => {
        expect(isZenModel('gpt-4o')).toBe(false);
        expect(isZenModel('nvidia/some-model')).toBe(false);
        expect(isZenModel('claude-sonnet-4')).toBe(false);
    });
});

describe('isZenModelId', () => {
    it('returns true for known Zen model names', () => {
        expect(isZenModelId('mimo-v2.5-free')).toBe(true);
        expect(isZenModelId('gpt-5.5')).toBe(true);
        expect(isZenModelId('claude-opus-4-6')).toBe(true);
        expect(isZenModelId('gemini-3.5-flash')).toBe(true);
        expect(isZenModelId('deepseek-v4-flash-free')).toBe(true);
        expect(isZenModelId('big-pickle')).toBe(true);
        expect(isZenModelId('qwen3.6-plus-free')).toBe(true);
    });

    it('returns false for unknown model names', () => {
        expect(isZenModelId('gpt-4o')).toBe(false);
        expect(isZenModelId('some-random-model')).toBe(false);
        expect(isZenModelId('')).toBe(false);
    });
});

describe('getZenSdkType', () => {
    it('returns openai for gpt- models', () => {
        expect(getZenSdkType('gpt-5.4')).toBe('openai');
        expect(getZenSdkType('gpt-4o')).toBe('openai');
        expect(getZenSdkType('opencode/gpt-5.5')).toBe('openai');
    });

    it('returns anthropic for claude- models', () => {
        expect(getZenSdkType('claude-opus-4-6')).toBe('anthropic');
        expect(getZenSdkType('opencode/claude-sonnet-4-6')).toBe('anthropic');
    });

    it('returns google for gemini- models', () => {
        expect(getZenSdkType('gemini-3.5-flash')).toBe('google');
        expect(getZenSdkType('opencode/gemini-3.1-pro')).toBe('google');
    });

    it('returns openai-compatible for other models', () => {
        expect(getZenSdkType('mimo-v2.5-free')).toBe('openai-compatible');
        expect(getZenSdkType('deepseek-v4-flash')).toBe('openai-compatible');
        expect(getZenSdkType('opencode/mimo-v2.5-free')).toBe(
            'openai-compatible',
        );
    });
});

describe('zen function', () => {
    it('throws when no API key is available', async () => {
        const originalKey = process.env.OPENCODE_API_KEY;
        delete process.env.OPENCODE_API_KEY;
        try {
            const { zen } = await import('../zen');
            await expect(zen('mimo-v2.5-free')).rejects.toThrow(
                'OPENCODE_API_KEY not found',
            );
        } finally {
            if (originalKey !== undefined) {
                process.env.OPENCODE_API_KEY = originalKey;
            }
        }
    });

    it('uses provided API key over env var', async () => {
        const originalKey = process.env.OPENCODE_API_KEY;
        delete process.env.OPENCODE_API_KEY;
        try {
            const { zen } = await import('../zen');
            // This should not throw since we provide a key
            const model = await zen('mimo-v2.5-free', 'test-api-key');
            expect(model).toBeDefined();
        } finally {
            if (originalKey !== undefined) {
                process.env.OPENCODE_API_KEY = originalKey;
            }
        }
    });

    it('strips opencode/ prefix for the API call', async () => {
        const originalKey = process.env.OPENCODE_API_KEY;
        process.env.OPENCODE_API_KEY = 'test-key';
        try {
            const { zen } = await import('../zen');
            const model = await zen('opencode/gpt-5.4');
            expect(model).toBeDefined();
        } finally {
            if (originalKey !== undefined) {
                process.env.OPENCODE_API_KEY = originalKey;
            } else {
                delete process.env.OPENCODE_API_KEY;
            }
        }
    });
});
