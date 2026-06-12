import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';

const ZEN_BASE_URL = 'https://opencode.ai/zen';

type ZenSdkType = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

const providerCache = new Map<
    string,
    | ReturnType<typeof createOpenAICompatible>
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createAnthropic>
    | ReturnType<typeof createGoogleGenerativeAI>
>();

function resolveSdkType(modelId: string): ZenSdkType {
    // Strip the "opencode/" prefix if present
    const id = modelId.startsWith('opencode/')
        ? modelId.slice('opencode/'.length)
        : modelId;

    if (id.startsWith('gpt-')) return 'openai';
    if (id.startsWith('claude-')) return 'anthropic';
    if (id.startsWith('gemini-')) return 'google';
    return 'openai-compatible';
}

function getOrCreateProvider(sdkType: ZenSdkType, apiKey: string) {
    const cacheKey = `${sdkType}:${apiKey}`;
    const cached = providerCache.get(cacheKey);
    if (cached) return cached;

    let provider:
        | ReturnType<typeof createOpenAICompatible>
        | ReturnType<typeof createOpenAI>
        | ReturnType<typeof createAnthropic>
        | ReturnType<typeof createGoogleGenerativeAI>;

    switch (sdkType) {
        case 'openai':
            provider = createOpenAI({
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
        case 'anthropic':
            provider = createAnthropic({
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
        case 'google':
            provider = createGoogleGenerativeAI({
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
        case 'openai-compatible':
        default:
            provider = createOpenAICompatible({
                name: 'opencode-zen',
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
    }

    providerCache.set(cacheKey, provider);
    return provider;
}

async function resolveZenKey(clientKey?: string): Promise<string> {
    // API keys are now provided by the client. Fall back to env var for backward compatibility.
    if (clientKey) return clientKey;
    return process.env.OPENCODE_API_KEY ?? '';
}

/**
 * Resolve an OpenCode Zen model to a LanguageModel instance.
 * Routes to the correct AI SDK based on model family.
 */
export async function zen(
    modelId: string,
    apiKey?: string,
): Promise<LanguageModelV3> {
    const resolvedKey = await resolveZenKey(apiKey);
    if (!resolvedKey) {
        throw new Error(
            'OPENCODE_API_KEY not found. ' +
                'Get your key at https://opencode.ai/auth',
        );
    }

    // Strip "opencode/" prefix for the actual API call
    const apiModelId = modelId.startsWith('opencode/')
        ? modelId.slice('opencode/'.length)
        : modelId;
    const sdkType = resolveSdkType(modelId);
    const provider = getOrCreateProvider(sdkType, resolvedKey);

    // Each SDK type returns a provider we call with the model ID
    return (provider as any)(apiModelId) as LanguageModelV3;
}

/**
 * Check if an OpenCode Zen model ID belongs to this provider.
 */
export function isZenModel(modelId: string): boolean {
    return modelId.startsWith('opencode/');
}

/**
 * Check if a model name (without prefix) is a known Zen model.
 * e.g., "mimo-v2.5-free" → true, "gpt-4o" → false
 */
const KNOWN_ZEN_MODEL_NAMES = new Set([
    'deepseek-v4-flash-free',
    'nemotron-3-ultra-free',
    'minimax-m3-free',
    'mimo-v2.5-free',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.3-codex',
    'gpt-5.2',
    'gpt-5.1-codex',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'gemini-3.5-flash',
    'gemini-3.1-pro',
    'grok-build-0.1',
    'deepseek-v4-flash',
    'kimi-k2.6',
    'glm-5.1',
    'qwen3.6-plus',
    'north-mini-code-free',
    'big-pickle',
    'qwen3.6-plus-free',
]);

export function isZenModelId(modelId: string): boolean {
    return KNOWN_ZEN_MODEL_NAMES.has(modelId);
}

/**
 * Get the SDK type for a Zen model (useful for provider-specific options).
 */
export function getZenSdkType(modelId: string): ZenSdkType {
    return resolveSdkType(modelId);
}
