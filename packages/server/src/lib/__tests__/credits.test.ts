import { describe, it, expect } from 'vitest';
import { calculateCreditsForUsage } from '../credits';

const defaultTokenDetails = {
    noCacheTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
};

const defaultOutputDetails = {
    textTokens: 0,
    reasoningTokens: 0,
};

function makeUsage(inputTokens: number, outputTokens: number) {
    return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        inputTokenDetails: defaultTokenDetails,
        outputTokenDetails: defaultOutputDetails,
    };
}

describe('calculateCreditsForUsage', () => {
    it('calculates credits for OpenAI GPT-4o', () => {
        // GPT-4o: $2.50/M input, $10/M output
        // 1000 input tokens: (1000 * 2.50) / 1_000_000 = $0.0025
        // 500 output tokens: (500 * 10) / 1_000_000 = $0.005
        // Total: $0.0075 → ceil(0.0075 / 0.01) = ceil(0.75) = 1
        const result = calculateCreditsForUsage({
            provider: 'openai',
            model: 'gpt-4o',
            usage: makeUsage(1000, 500),
        });
        expect(result.credits).toBe(1);
    });

    it('calculates credits for large usage', () => {
        // 100K input tokens on GPT-4o: (100000 * 2.50) / 1_000_000 = $0.25
        // 50K output tokens: (50000 * 10) / 1_000_000 = $0.50
        // Total: $0.75 → ceil(0.75 / 0.01) = 75
        const result = calculateCreditsForUsage({
            provider: 'openai',
            model: 'gpt-4o',
            usage: makeUsage(100_000, 50_000),
        });
        expect(result.credits).toBe(75);
    });

    it('handles NVIDIA models (free) with zero cost', () => {
        // NVIDIA models have $0 pricing
        const result = calculateCreditsForUsage({
            provider: 'nvidia',
            model: 'nvidia/deepseek-ai/deepseek-v4-flash',
            usage: makeUsage(10000, 5000),
        });
        expect(result.credits).toBe(0);
    });

    it('calculates for Anthropic Claude Sonnet 4', () => {
        // Claude Sonnet 4: $3/M input, $15/M output
        // 1000 input: $0.003, 200 output: $0.003
        // Total: $0.006 → ceil(0.006 / 0.01) = ceil(0.6) = 1
        const result = calculateCreditsForUsage({
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            usage: makeUsage(1000, 200),
        });
        expect(result.credits).toBe(1);
    });

    it('calculates for Groq Llama 3.3 70B', () => {
        // Llama 3.3 70B: $0.59/M input, $0.79/M output
        // 1000 input: $0.00059, 1000 output: $0.00079
        // Total: $0.00138 → ceil(0.00138 / 0.01) = ceil(0.138) = 1
        const result = calculateCreditsForUsage({
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            usage: makeUsage(1000, 1000),
        });
        expect(result.credits).toBe(1);
    });

    it('returns 0 for zero token usage', () => {
        const result = calculateCreditsForUsage({
            provider: 'openai',
            model: 'gpt-4o',
            usage: makeUsage(0, 0),
        });
        expect(result.credits).toBe(0);
    });

    it('returns 0 credits for unsupported provider', () => {
        const result = calculateCreditsForUsage({
            provider: 'unknown-provider',
            model: 'some-model',
            usage: makeUsage(100, 50),
        });
        expect(result.credits).toBe(0);
    });

    it('returns 0 credits for unsupported model', () => {
        const result = calculateCreditsForUsage({
            provider: 'openai',
            model: 'unknown-model',
            usage: makeUsage(100, 50),
        });
        expect(result.credits).toBe(0);
    });

    it('throws for non-integer token counts', () => {
        expect(() =>
            calculateCreditsForUsage({
                provider: 'openai',
                model: 'gpt-4o',
                usage: { ...makeUsage(0, 50), inputTokens: NaN },
            }),
        ).toThrow();
    });

    it('returns at least 1 credit for any positive cost', () => {
        // GPT-4o Mini: $0.15/M input, $0.60/M output
        // 10 input tokens: $0.0000015, 10 output: $0.000006
        // Total: $0.0000075 → ceil(0.0000075 / 0.01) = ceil(0.00075) = 1
        const result = calculateCreditsForUsage({
            provider: 'openai',
            model: 'gpt-4o-mini',
            usage: makeUsage(10, 10),
        });
        expect(result.credits).toBe(1);
    });
});
