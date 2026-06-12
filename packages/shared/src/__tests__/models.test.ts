import { describe, it, expect } from 'vitest';
import {
    SUPPORTED_CHAT_MODELS,
    DEFAULT_CHAT_MODEL_ID,
    findSupportedChatModel,
} from '../models';

describe('SUPPORTED_CHAT_MODELS', () => {
    it('contains at least one model from each provider', () => {
        const providers = new Set(SUPPORTED_CHAT_MODELS.map((m) => m.provider));
        expect(providers.has('nvidia')).toBe(true);
        expect(providers.has('anthropic')).toBe(true);
        expect(providers.has('openai')).toBe(true);
        expect(providers.has('groq')).toBe(true);
    });

    it('has unique model IDs', () => {
        const ids = SUPPORTED_CHAT_MODELS.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('has valid pricing for all models', () => {
        for (const model of SUPPORTED_CHAT_MODELS) {
            expect(
                model.pricing.inputUsdPerMillionTokens,
            ).toBeGreaterThanOrEqual(0);
            expect(
                model.pricing.outputUsdPerMillionTokens,
            ).toBeGreaterThanOrEqual(0);
        }
    });

    it('has expected NVIDIA models', () => {
        const nvidiaModels = SUPPORTED_CHAT_MODELS.filter(
            (m) => m.provider === 'nvidia',
        );
        expect(nvidiaModels.length).toBeGreaterThan(10);
        expect(nvidiaModels.some((m) => m.id.includes('deepseek-v4'))).toBe(
            true,
        );
    });

    it('has expected Anthropic models', () => {
        const anthroModels = SUPPORTED_CHAT_MODELS.filter(
            (m) => m.provider === 'anthropic',
        );
        expect(anthroModels.some((m) => m.id.includes('claude-sonnet-4'))).toBe(
            true,
        );
        expect(
            anthroModels.some((m) => m.id.includes('claude-3-5-haiku')),
        ).toBe(true);
    });

    it('has expected OpenAI models', () => {
        const openaiModels = SUPPORTED_CHAT_MODELS.filter(
            (m) => m.provider === 'openai',
        );
        expect(openaiModels.some((m) => m.id === 'gpt-4o')).toBe(true);
        expect(openaiModels.some((m) => m.id === 'gpt-4o-mini')).toBe(true);
        expect(openaiModels.some((m) => m.id === 'o3-mini')).toBe(true);
    });

    it('has expected Groq models', () => {
        const groqModels = SUPPORTED_CHAT_MODELS.filter(
            (m) => m.provider === 'groq',
        );
        expect(groqModels.some((m) => m.id.includes('llama-3.3'))).toBe(true);
        expect(groqModels.some((m) => m.id.includes('mixtral'))).toBe(true);
    });
});

describe('findSupportedChatModel', () => {
    it('finds a model by full ID', () => {
        const model = findSupportedChatModel('gpt-4o');
        expect(model).toBeDefined();
        expect(model!.provider).toBe('openai');
    });

    it('returns undefined for unknown models', () => {
        const model = findSupportedChatModel('unknown-model-xyz');
        expect(model).toBeUndefined();
    });

    it('finds NVIDIA models', () => {
        const model = findSupportedChatModel(
            'nvidia/deepseek-ai/deepseek-v4-flash',
        );
        expect(model).toBeDefined();
        expect(model!.provider).toBe('nvidia');
    });

    it('finds Claude Sonnet', () => {
        const model = findSupportedChatModel('claude-sonnet-4-20250514');
        expect(model).toBeDefined();
        expect(model!.provider).toBe('anthropic');
    });
});

describe('DEFAULT_CHAT_MODEL_ID', () => {
    it('is a valid supported model', () => {
        const model = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID);
        expect(model).toBeDefined();
    });

    it('is an NVIDIA model', () => {
        const model = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID);
        expect(model!.provider).toBe('nvidia');
    });
});
