import { describe, it, expect } from 'vitest';
import {
    PROVIDER_KEYCHAIN_NAMES,
    PROVIDER_ENV_VARS,
    resolveProviderForModel,
    getKeychainName,
} from '../provider-keys';

describe('PROVIDER_KEYCHAIN_NAMES', () => {
    it('maps each provider to a keychain account name', () => {
        expect(PROVIDER_KEYCHAIN_NAMES.nvidia).toBe('nim-api-key');
        expect(PROVIDER_KEYCHAIN_NAMES.anthropic).toBe('anthropic-api-key');
        expect(PROVIDER_KEYCHAIN_NAMES.openai).toBe('openai-api-key');
        expect(PROVIDER_KEYCHAIN_NAMES.groq).toBe('groq-api-key');
        expect(PROVIDER_KEYCHAIN_NAMES.opencode).toBe('opencode-api-key');
        expect(PROVIDER_KEYCHAIN_NAMES.kilo).toBe('kilo-api-key');
    });

    it('has entries for all expected providers', () => {
        const keys = Object.keys(PROVIDER_KEYCHAIN_NAMES);
        expect(keys).toContain('nvidia');
        expect(keys).toContain('anthropic');
        expect(keys).toContain('openai');
        expect(keys).toContain('groq');
        expect(keys).toContain('opencode');
        expect(keys).toContain('kilo');
        expect(keys).toContain('gemini');
        expect(keys).toContain('deepseek');
        expect(keys).toContain('together');
        expect(keys).toContain('fireworks');
        expect(keys).toContain('cerebras');
        expect(keys).toContain('openrouter');
        expect(keys).toContain('cline');
    });
});

describe('PROVIDER_ENV_VARS', () => {
    it('maps each provider to its env var name', () => {
        expect(PROVIDER_ENV_VARS.nvidia).toBe('NIM_API_KEY');
        expect(PROVIDER_ENV_VARS.anthropic).toBe('ANTHROPIC_API_KEY');
        expect(PROVIDER_ENV_VARS.openai).toBe('OPENAI_API_KEY');
        expect(PROVIDER_ENV_VARS.groq).toBe('GROQ_API_KEY');
        expect(PROVIDER_ENV_VARS.opencode).toBe('OPENCODE_API_KEY');
        expect(PROVIDER_ENV_VARS.kilo).toBe('KILO_API_KEY');
        expect(PROVIDER_ENV_VARS.gemini).toBe('GOOGLE_API_KEY');
        expect(PROVIDER_ENV_VARS.deepseek).toBe('DEEPSEEK_API_KEY');
        expect(PROVIDER_ENV_VARS.together).toBe('TOGETHER_API_KEY');
        expect(PROVIDER_ENV_VARS.fireworks).toBe('FIREWORKS_API_KEY');
        expect(PROVIDER_ENV_VARS.cerebras).toBe('CEREBRAS_API_KEY');
        expect(PROVIDER_ENV_VARS.openrouter).toBe('OPENROUTER_API_KEY');
        expect(PROVIDER_ENV_VARS.cline).toBe('CLINE_API_KEY');
    });
});

describe('resolveProviderForModel', () => {
    it('resolves known hardcoded model IDs to their provider', () => {
        // GPT-4o is openai, Claude Sonnet is anthropic
        expect(resolveProviderForModel('gpt-4o')).toBe('openai');
        expect(resolveProviderForModel('claude-sonnet-4-20250514')).toBe(
            'anthropic',
        );
        expect(resolveProviderForModel('gpt-4o-mini')).toBe('openai');
    });

    it('resolves nvidia/ prefixed models to nvidia', () => {
        expect(resolveProviderForModel('nvidia/google/gemma-4-31b-it')).toBe(
            'nvidia',
        );
    });

    it('resolves openrouter/ prefixed models to openrouter', () => {
        expect(
            resolveProviderForModel('openrouter/anthropic/claude-3.5-sonnet'),
        ).toBe('openrouter');
    });

    it('resolves together/ prefixed models to together', () => {
        expect(resolveProviderForModel('together/meta-llama/Llama-3-70b')).toBe(
            'together',
        );
    });

    it('resolves fireworks/ prefixed models to fireworks', () => {
        expect(
            resolveProviderForModel('fireworks/accounts/fireworks/models/test'),
        ).toBe('fireworks');
    });

    it('resolves cerebras/ prefixed models to cerebras', () => {
        expect(resolveProviderForModel('cerebras/llama-3.3-70b')).toBe(
            'cerebras',
        );
    });

    it('resolves deepseek/ prefixed models to deepseek', () => {
        expect(resolveProviderForModel('deepseek/deepseek-chat')).toBe(
            'deepseek',
        );
    });

    it('resolves gemini/ prefixed models to gemini', () => {
        expect(resolveProviderForModel('gemini/gemini-2.5-pro')).toBe('gemini');
    });

    it('resolves google/ prefixed models to gemini', () => {
        expect(resolveProviderForModel('google/gemini-2.5-pro')).toBe('gemini');
    });

    it('resolves opencode/ prefixed models to opencode', () => {
        expect(resolveProviderForModel('opencode/mimo-v2.5-free')).toBe(
            'opencode',
        );
    });

    it('resolves kilo/ prefixed models to kilo', () => {
        expect(
            resolveProviderForModel('kilo/anthropic/claude-sonnet-4.5'),
        ).toBe('kilo');
    });

    it('resolves cline/ prefixed models to cline', () => {
        expect(resolveProviderForModel('cline/gpt-4o')).toBe('cline');
    });

    it('throws for completely unknown model IDs', () => {
        expect(() => resolveProviderForModel('unknown-model')).toThrow(
            'Cannot resolve provider',
        );
    });
});

describe('getKeychainName', () => {
    it('returns the keychain name for a provider', () => {
        expect(getKeychainName('nvidia')).toBe('nim-api-key');
        expect(getKeychainName('anthropic')).toBe('anthropic-api-key');
        expect(getKeychainName('kilo')).toBe('kilo-api-key');
        expect(getKeychainName('cline')).toBe('cline-api-key');
    });
});
