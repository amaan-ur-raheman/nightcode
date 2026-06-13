import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { SUPPORTED_CHAT_MODELS } from '@nightcode/shared';
import { zen, isZenModel, isZenModelId } from './zen';
import { requestQueue } from './request-queue';

type ProviderConfig = {
    name: string;
    baseUrl: string;
    apiKey: string;
    models: Array<{ id: string; name: string }>;
};

type ProviderInstance = {
    config: ProviderConfig;
    getClient: (modelId: string) => LanguageModelV3;
};

const providerCache = new Map<
    string,
    ReturnType<typeof createOpenAICompatible>
>();

/**
 * Circuit breaker for provider failures.
 * Tracks failures per provider and opens the circuit after 3 failures,
 * preventing wasted requests to known-bad endpoints.
 */
class CircuitBreaker {
    private failures = new Map<string, number>();
    private lastFailure = new Map<string, number>();
    private readonly maxFailures = 3;
    private readonly resetTimeoutMs = 60_000; // 60 seconds

    /**
     * Check if a provider's circuit is open (should be skipped).
     */
    isOpen(provider: string): boolean {
        const failCount = this.failures.get(provider) ?? 0;
        if (failCount < this.maxFailures) return false;

        const lastFail = this.lastFailure.get(provider) ?? 0;
        if (Date.now() - lastFail > this.resetTimeoutMs) {
            // Half-open: allow one retry after timeout
            this.failures.set(provider, this.maxFailures - 1);
            return false;
        }
        return true;
    }

    /**
     * Record a failure for a provider.
     */
    recordFailure(provider: string): void {
        const current = this.failures.get(provider) ?? 0;
        this.failures.set(provider, current + 1);
        this.lastFailure.set(provider, Date.now());
    }

    /**
     * Reset failure count on success (circuit closes).
     */
    recordSuccess(provider: string): void {
        this.failures.delete(provider);
        this.lastFailure.delete(provider);
    }
}

export const circuitBreaker = new CircuitBreaker();

function getOrCreateProvider(name: string, baseUrl: string, apiKey: string) {
    const cacheKey = `${name}:${apiKey}`;
    let provider = providerCache.get(cacheKey);
    if (!provider) {
        provider = createOpenAICompatible({
            name,
            baseURL: baseUrl,
            apiKey,
        });
        providerCache.set(cacheKey, provider);
    }
    return provider;
}

// Model lists derived from SUPPORTED_CHAT_MODELS to avoid drift
// between shared/models.ts and server/providers.ts
function modelsForProvider(
    provider: string,
): Array<{ id: string; name: string }> {
    return SUPPORTED_CHAT_MODELS.filter((m) => m.provider === provider).map(
        (m) => ({ id: m.id, name: m.id.split('/').pop() ?? m.id }),
    );
}

const NIM_PROVIDER: ProviderConfig = {
    name: 'nim',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKey: '',
    models: modelsForProvider('nvidia'),
};

const ANTHROPIC_PROVIDER: ProviderConfig = {
    name: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    models: modelsForProvider('anthropic'),
};

const OPENAI_PROVIDER: ProviderConfig = {
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: modelsForProvider('openai'),
};

const GROQ_PROVIDER: ProviderConfig = {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    models: modelsForProvider('groq'),
};

const OPENCODE_PROVIDER: ProviderConfig = {
    name: 'opencode',
    baseUrl: 'https://opencode.ai/zen',
    apiKey: '',
    models: modelsForProvider('opencode'),
};

const OPENROUTER_PROVIDER: ProviderConfig = {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    models: [],
};

const TOGETHER_PROVIDER: ProviderConfig = {
    name: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: '',
    models: [],
};

const FIREWORKS_PROVIDER: ProviderConfig = {
    name: 'fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKey: '',
    models: [],
};

const CEREBRAS_PROVIDER: ProviderConfig = {
    name: 'cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKey: '',
    models: [],
};

const DEEPSEEK_PROVIDER: ProviderConfig = {
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    models: [],
};

const GEMINI_PROVIDER: ProviderConfig = {
    name: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    models: [],
};

const KILO_PROVIDER: ProviderConfig = {
    name: 'kilo',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    apiKey: '',
    models: [],
};

const LOCAL_PROVIDER: ProviderConfig = {
    name: 'local',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    models: [],
};

const LIGHTNINGAI_PROVIDER: ProviderConfig = {
    name: 'lightningai',
    baseUrl: 'https://lightning.ai/api/v1',
    apiKey: '',
    models: [],
};

const ALL_PROVIDERS: ProviderConfig[] = [
    NIM_PROVIDER,
    ANTHROPIC_PROVIDER,
    OPENAI_PROVIDER,
    GROQ_PROVIDER,
    OPENCODE_PROVIDER,
    OPENROUTER_PROVIDER,
    TOGETHER_PROVIDER,
    FIREWORKS_PROVIDER,
    CEREBRAS_PROVIDER,
    DEEPSEEK_PROVIDER,
    GEMINI_PROVIDER,
    KILO_PROVIDER,
    LOCAL_PROVIDER,
    LIGHTNINGAI_PROVIDER,
];

// Provider prefix mapping for dynamic model IDs
const PROVIDER_PREFIXES: Record<string, string> = {
    'nvidia/': 'nim',
    'openrouter/': 'openrouter',
    'together/': 'together',
    'fireworks/': 'fireworks',
    'cerebras/': 'cerebras',
    'deepseek/': 'deepseek',
    'gemini/': 'gemini',
    'google/': 'gemini',
    'kilo/': 'kilo',
    'local/': 'local',
    'lightningai/': 'lightningai',
};

function findProviderForModel(modelId: string): ProviderConfig | undefined {
    // First try exact match in hardcoded models
    const exactMatch = ALL_PROVIDERS.find((p) =>
        p.models.some((m) => m.id === modelId),
    );
    if (exactMatch) return exactMatch;

    // Then try provider prefix matching for dynamic models
    for (const [prefix, providerName] of Object.entries(PROVIDER_PREFIXES)) {
        if (modelId.startsWith(prefix)) {
            return ALL_PROVIDERS.find((p) => p.name === providerName);
        }
    }

    return undefined;
}

function getProviderForDynamicModel(
    modelId: string,
): { provider: ProviderConfig; actualModelId: string } | undefined {
    // Check if model ID has a provider prefix (e.g., "openrouter/anthropic/claude-3.5-sonnet")
    for (const [prefix, providerName] of Object.entries(PROVIDER_PREFIXES)) {
        if (modelId.startsWith(prefix)) {
            const provider = ALL_PROVIDERS.find((p) => p.name === providerName);
            if (provider) {
                // Strip the prefix to get the actual model ID for the provider
                const actualModelId = modelId.slice(prefix.length);
                return { provider, actualModelId };
            }
        }
    }
    return undefined;
}

function wrapModelWithQueue(model: LanguageModelV3): LanguageModelV3 {
    return {
        ...model,
        doGenerate: async (params: any): Promise<any> =>
            await requestQueue.enqueue(
                async () => model.doGenerate(params) as any,
            ),
        doStream: async (params: any): Promise<any> =>
            await requestQueue.enqueue(
                async () => model.doStream(params) as any,
            ),
    } as any;
}

/**
 * Resolve a provider client for the given model ID.
 *
 * API keys are now provided by the client via the `apiKey` parameter.
 * The server no longer reads keys from the OS keychain or env vars.
 * If no apiKey is provided, the server falls back to env vars for backward compatibility.
 */
export async function getProviderClient(
    modelId: string,
    apiKey?: string,
): Promise<LanguageModelV3> {
    // OpenCode Zen models use multi-SDK routing
    if (isZenModel(modelId)) {
        const providerName = 'opencode';
        if (circuitBreaker.isOpen(providerName)) {
            throw new Error(
                `Provider "${providerName}" is temporarily unavailable due to repeated failures. Try again later.`,
            );
        }
        try {
            const model = await zen(modelId, apiKey);
            circuitBreaker.recordSuccess(providerName);
            return wrapModelWithQueue(model);
        } catch (error) {
            circuitBreaker.recordFailure(providerName);
            throw error;
        }
    }

    // Check for dynamic model with provider prefix
    const dynamicProvider = getProviderForDynamicModel(modelId);
    if (dynamicProvider) {
        const { provider, actualModelId } = dynamicProvider;
        if (circuitBreaker.isOpen(provider.name)) {
            throw new Error(
                `Provider "${provider.name}" is temporarily unavailable due to repeated failures. Try again later.`,
            );
        }
        const resolvedKey = apiKey || provider.apiKey || '';
        if (!resolvedKey) {
            throw new Error(
                `No API key provided for provider "${provider.name}". ` +
                    `Configure the key in your client settings.`,
            );
        }
        try {
            // Gemini uses a non-OpenAI-compatible API, route through Google AI SDK
            if (provider.name === 'gemini') {
                const googleProvider = createGoogleGenerativeAI({
                    apiKey: resolvedKey,
                });
                circuitBreaker.recordSuccess(provider.name);
                return wrapModelWithQueue(googleProvider(actualModelId));
            }
            const sdk = getOrCreateProvider(
                provider.name,
                provider.baseUrl,
                resolvedKey,
            );
            circuitBreaker.recordSuccess(provider.name);
            return wrapModelWithQueue(sdk(actualModelId));
        } catch (error) {
            circuitBreaker.recordFailure(provider.name);
            throw error;
        }
    }

    const provider = findProviderForModel(modelId);

    if (!provider) {
        throw new Error(
            `No provider found for model "${modelId}". ` +
                `Check the model ID or configure the appropriate provider.`,
        );
    }

    if (circuitBreaker.isOpen(provider.name)) {
        throw new Error(
            `Provider "${provider.name}" is temporarily unavailable due to repeated failures. Try again later.`,
        );
    }

    const resolvedKey = apiKey || provider.apiKey || '';
    if (!resolvedKey) {
        throw new Error(
            `No API key provided for provider "${provider.name}". ` +
                `Configure the key in your client settings.`,
        );
    }

    try {
        const sdk = getOrCreateProvider(
            provider.name,
            provider.baseUrl,
            resolvedKey,
        );
        circuitBreaker.recordSuccess(provider.name);
        return wrapModelWithQueue(sdk(modelId));
    } catch (error) {
        circuitBreaker.recordFailure(provider.name);
        throw error;
    }
}

export async function isModelAvailable(modelId: string): Promise<boolean> {
    const provider = findProviderForModel(modelId);
    return provider !== undefined;
}

export function getProviderName(modelId: string): string {
    // Check for dynamic model with provider prefix
    for (const [prefix, providerName] of Object.entries(PROVIDER_PREFIXES)) {
        if (modelId.startsWith(prefix)) {
            return providerName;
        }
    }

    const provider = findProviderForModel(modelId);
    return provider?.name ?? 'nim';
}

export { isZenModelId };
