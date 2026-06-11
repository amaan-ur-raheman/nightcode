import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { keychain } from "@nightcode/shared";
import { zen, isZenModel } from "./zen";
import { requestQueue } from "./request-queue";

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

const providerCache = new Map<string, ReturnType<typeof createOpenAICompatible>>();

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

async function resolveApiKey(envVar: string, keychainName: string): Promise<string> {
    if (keychain.isAvailable()) {
        const key = await keychain.getKey(keychainName);
        if (key) return key;
    }
    return process.env[envVar] ?? "";
}

const NIM_PROVIDER: ProviderConfig = {
    name: "nim",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: process.env.NIM_API_KEY ?? "",
    models: [
        { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B" },
        { id: "stepfun-ai/step-3.7-flash", name: "Step 3.7 Flash" },
        { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
        { id: "mistralai/mistral-medium-3.5-128b", name: "Mistral Medium 3.5" },
        { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", name: "Nemotron 3 Nano 30B" },
        { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
        { id: "z-ai/glm-5.1", name: "GLM 5.1" },
        { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7" },
        { id: "google/gemma-4-31b-it", name: "Gemma 4 31B" },
        { id: "mistralai/mistral-small-4-119b-2603", name: "Mistral Small 4" },
        { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super 120B" },
        { id: "qwen/qwen3.5-122b-a10b", name: "Qwen 3.5 122B" },
        { id: "qwen/qwen3.5-397b-a17b", name: "Qwen 3.5 397B" },
        { id: "stepfun-ai/step-3.5-flash", name: "Step 3.5 Flash" },
        { id: "meta/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick" },
        { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    ],
};

const ANTHROPIC_PROVIDER: ProviderConfig = {
    name: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    models: [
        { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
        { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
    ],
};

const OPENAI_PROVIDER: ProviderConfig = {
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    models: [
        { id: "gpt-4o", name: "GPT-4o" },
        { id: "gpt-4o-mini", name: "GPT-4o Mini" },
        { id: "o3-mini", name: "o3-mini" },
    ],
};

const GROQ_PROVIDER: ProviderConfig = {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY ?? "",
    models: [
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
        { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
    ],
};

const OPENCODE_PROVIDER: ProviderConfig = {
    name: "opencode",
    baseUrl: "https://opencode.ai/zen",
    apiKey: "",
    models: [
        // Free models
        { id: "opencode/deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free" },
        { id: "opencode/nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free" },
        { id: "opencode/minimax-m3-free", name: "MiniMax M3 Free" },
        { id: "opencode/mimo-v2.5-free", name: "MiMo V2.5 Free" },
        // Paid models - OpenAI
        { id: "opencode/gpt-5.5", name: "GPT 5.5" },
        { id: "opencode/gpt-5.4", name: "GPT 5.4" },
        { id: "opencode/gpt-5.4-mini", name: "GPT 5.4 Mini" },
        { id: "opencode/gpt-5.4-nano", name: "GPT 5.4 Nano" },
        { id: "opencode/gpt-5.3-codex", name: "GPT 5.3 Codex" },
        { id: "opencode/gpt-5.2", name: "GPT 5.2" },
        { id: "opencode/gpt-5.1-codex", name: "GPT 5.1 Codex" },
        // Paid models - Anthropic
        { id: "opencode/claude-opus-4-6", name: "Claude Opus 4.6" },
        { id: "opencode/claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
        { id: "opencode/claude-haiku-4-5", name: "Claude Haiku 4.5" },
        // Paid models - Google
        { id: "opencode/gemini-3.5-flash", name: "Gemini 3.5 Flash" },
        { id: "opencode/gemini-3.1-pro", name: "Gemini 3.1 Pro" },
        // Paid models - Other
        { id: "opencode/grok-build-0.1", name: "Grok Build 0.1" },
        { id: "opencode/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { id: "opencode/kimi-k2.6", name: "Kimi K2.6" },
        { id: "opencode/glm-5.1", name: "GLM 5.1" },
        { id: "opencode/qwen3.6-plus", name: "Qwen3.6 Plus" },
    ],
};

const ALL_PROVIDERS: ProviderConfig[] = [
    NIM_PROVIDER,
    ANTHROPIC_PROVIDER,
    OPENAI_PROVIDER,
    GROQ_PROVIDER,
    OPENCODE_PROVIDER,
];

async function resolveAllApiKeys(): Promise<void> {
    const keys = await Promise.all([
        resolveApiKey("NIM_API_KEY", "nim-api-key"),
        resolveApiKey("ANTHROPIC_API_KEY", "anthropic-api-key"),
        resolveApiKey("OPENAI_API_KEY", "openai-api-key"),
        resolveApiKey("GROQ_API_KEY", "groq-api-key"),
        resolveApiKey("OPENCODE_API_KEY", "opencode-api-key"),
    ]);
    
    NIM_PROVIDER.apiKey = keys[0];
    ANTHROPIC_PROVIDER.apiKey = keys[1];
    OPENAI_PROVIDER.apiKey = keys[2];
    GROQ_PROVIDER.apiKey = keys[3];
    OPENCODE_PROVIDER.apiKey = keys[4];
}

let _keysResolved = false;

async function resetKeysResolved(): Promise<void> {
    _keysResolved = false;
}

async function ensureKeysResolved(): Promise<void> {
    if (!_keysResolved) {
        await resolveAllApiKeys();
        _keysResolved = true;
    }
}

function findProviderForModel(modelId: string): ProviderConfig | undefined {
    return ALL_PROVIDERS.find((p) =>
        p.apiKey && p.models.some((m) => m.id === modelId)
    );
}

function wrapModelWithQueue(model: LanguageModelV3): LanguageModelV3 {
    return {
        ...model,
        doGenerate: async (params: any): Promise<any> => await requestQueue.enqueue(async () => model.doGenerate(params) as any),
        doStream: async (params: any): Promise<any> => await requestQueue.enqueue(async () => model.doStream(params) as any),
    } as any;
}

export async function getProviderClient(modelId: string): Promise<LanguageModelV3> {
    await ensureKeysResolved();
    
    // OpenCode Zen models use multi-SDK routing
    if (isZenModel(modelId)) {
        const model = await zen(modelId);
        return wrapModelWithQueue(model);
    }
    
    const provider = findProviderForModel(modelId);

    if (!provider) {
        throw new Error(
            `No provider found for model "${modelId}". ` +
            `Check the model ID or configure the appropriate provider.`
        );
    }

    if (!provider.apiKey) {
        throw new Error(
            `No API key configured for provider "${provider.name}". ` +
            `Set the appropriate environment variable or store in OS keychain.`
        );
    }

    const sdk = getOrCreateProvider(provider.name, provider.baseUrl, provider.apiKey);
    return wrapModelWithQueue(sdk(modelId));
}

export async function getAllModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    await ensureKeysResolved();
    
    const models: Array<{ id: string; name: string; provider: string }> = [];

    for (const provider of ALL_PROVIDERS) {
        if (!provider.apiKey) continue;
        for (const model of provider.models) {
            models.push({
                id: model.id,
                name: model.name,
                provider: provider.name,
            });
        }
    }

    return models;
}

export async function isModelAvailable(modelId: string): Promise<boolean> {
    await ensureKeysResolved();
    const provider = findProviderForModel(modelId);
    return provider !== undefined && !!provider.apiKey;
}

export function getProviderName(modelId: string): string {
    const provider = findProviderForModel(modelId);
    return provider?.name ?? "nim";
}
