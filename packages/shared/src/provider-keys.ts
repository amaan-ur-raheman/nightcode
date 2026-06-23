import type { SupportedProvider } from './models';
import { findSupportedChatModel } from './models';

/**
 * Maps each provider to its OS keychain account name.
 * Used by both client (for storing/reading keys) and server (for validation).
 */
export const PROVIDER_KEYCHAIN_NAMES: Record<SupportedProvider, string> = {
    nvidia: 'nim-api-key',
    anthropic: 'anthropic-api-key',
    openai: 'openai-api-key',
    groq: 'groq-api-key',
    opencode: 'opencode-api-key',
    openrouter: 'openrouter-api-key',
    together: 'together-api-key',
    fireworks: 'fireworks-api-key',
    cerebras: 'cerebras-api-key',
    deepseek: 'deepseek-api-key',
    gemini: 'google-api-key',
    kilo: 'kilo-api-key',
    local: 'local-api-key',
    lightningai: 'lightningai-api-key',
    cloudflare: 'cloudflare-api-key',
    zenmux: 'zenmux-api-key',
    mistral: 'mistral-api-key',
    qwen: 'qwen-api-key',
    perplexity: 'perplexity-api-key',
    cohere: 'cohere-api-key',
    huggingface: 'hf-api-key',
    zhipu: 'zhipu-api-key',
    moonshot: 'moonshot-api-key',
    lmstudio: 'lmstudio-api-key',
    xai: 'xai-api-key',
    minimax: 'minimax-api-key',
    sambanova: 'sambanova-api-key',
    siliconflow: 'siliconflow-api-key',
    deepinfra: 'deepinfra-api-key',
    novita: 'novita-api-key',
    nebius: 'nebius-api-key',
};

/**
 * Maps each provider to its corresponding env var name.
 */
export const PROVIDER_ENV_VARS: Record<SupportedProvider, string> = {
    nvidia: 'NIM_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    groq: 'GROQ_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    together: 'TOGETHER_API_KEY',
    fireworks: 'FIREWORKS_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    gemini: 'GOOGLE_API_KEY',
    kilo: 'KILO_API_KEY',
    local: 'LOCAL_API_KEY',
    lightningai: 'LIGHTNINGAI_API_KEY',
    cloudflare: 'CLOUDFLARE_API_KEY',
    zenmux: 'ZENMUX_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    qwen: 'DASHSCOPE_API_KEY',
    perplexity: 'PERPLEXITY_API_KEY',
    cohere: 'COHERE_API_KEY',
    huggingface: 'HF_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    lmstudio: '',
    xai: 'XAI_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    sambanova: 'SAMBANOVA_API_KEY',
    siliconflow: 'SILICONFLOW_API_KEY',
    deepinfra: 'DEEPINFRA_API_TOKEN',
    novita: 'NOVITA_API_KEY',
    nebius: 'NEBIUS_API_KEY',
};

/**
 * Provider prefix mapping for dynamic model IDs.
 * E.g. "openrouter/anthropic/claude-3.5-sonnet" → "openrouter"
 */
const PROVIDER_PREFIXES: Record<string, SupportedProvider> = {
    'nvidia/': 'nvidia',
    'openrouter/': 'openrouter',
    'together/': 'together',
    'fireworks/': 'fireworks',
    'cerebras/': 'cerebras',
    'deepseek/': 'deepseek',
    'gemini/': 'gemini',
    'google/': 'gemini',
    'opencode/': 'opencode',
    'kilo/': 'kilo',
    'local/': 'local',
    'lightningai/': 'lightningai',
    'cloudflare/': 'cloudflare',
    'zenmux/': 'zenmux',
    'mistral/': 'mistral',
    'qwen/': 'qwen',
    'perplexity/': 'perplexity',
    'cohere/': 'cohere',
    'huggingface/': 'huggingface',
    'zhipu/': 'zhipu',
    'moonshot/': 'moonshot',
    'lmstudio/': 'lmstudio',
    'xai/': 'xai',
    'minimax/': 'minimax',
    'sambanova/': 'sambanova',
    'siliconflow/': 'siliconflow',
    'deepinfra/': 'deepinfra',
    'novita/': 'novita',
    'nebius/': 'nebius',
};

/**
 * Resolve the provider for a given model ID.
 * Uses prefix matching for dynamic models, then falls back to hardcoded model lookup.
 */
export function resolveProviderForModel(modelId: string): SupportedProvider {
    // Try matching against hardcoded models first — this ensures NIM models
    // like "nvidia/google/gemma-4-31b-it" resolve correctly via the model
    // registry rather than prefix matching.
    const model = findSupportedChatModel(modelId);
    if (model) {
        return model.provider;
    }

    // Then try prefix matching for dynamic models
    for (const [prefix, provider] of Object.entries(PROVIDER_PREFIXES)) {
        if (modelId.startsWith(prefix)) {
            return provider;
        }
    }

    // Unknown model IDs should not silently default to nvidia —
    // this would send the wrong API key to the wrong provider.
    throw new Error(
        `Cannot resolve provider for model "${modelId}". Check the model ID or configure the appropriate provider.`,
    );
}

/**
 * Get the keychain account name for a given provider.
 */
export function getKeychainName(provider: SupportedProvider): string {
    return PROVIDER_KEYCHAIN_NAMES[provider];
}

/**
 * Special keychain name for Cloudflare Workers AI Account ID.
 * This is stored separately from the API key.
 */
export const CLOUDFLARE_ACCOUNT_ID_KEYCHAIN = 'cloudflare-account-id';
