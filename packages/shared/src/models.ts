export type ModelPricing = {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
};

export type DynamicModel = {
    id: string;
    displayName: string;
    provider: SupportedProvider;
    contextLength?: number;
    pricing?: ModelPricing;
    capabilities?: {
        vision?: boolean;
        tools?: boolean;
        reasoning?: boolean;
    };
};

export type ModelsApiResponse = {
    models: DynamicModel[];
    providers: string[];
    cached: boolean;
    fetchedAt: number;
};

export type SupportedProvider =
    | 'nvidia'
    | 'anthropic'
    | 'openai'
    | 'groq'
    | 'opencode'
    | 'openrouter'
    | 'together'
    | 'fireworks'
    | 'cerebras'
    | 'deepseek'
    | 'gemini'
    | 'kilo'
    | 'local'
    | 'lightningai'
    | 'cloudflare'
    | 'zenmux'
    | 'mistral'
    | 'qwen'
    | 'perplexity'
    | 'cohere'
    | 'huggingface'
    | 'zhipu'
    | 'moonshot'
    | 'lmstudio'
    | 'xai'
    | 'minimax'
    | 'sambanova'
    | 'siliconflow'
    | 'deepinfra'
    | 'novita'
    | 'nebius'
    | 'cline';

type SupportedChatModelDefinition = {
    id: string;
    provider: SupportedProvider;
    pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
    // ── NVIDIA NIM ──
    {
        id: 'nvidia/nemotron-3-ultra-550b-a55b',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/stepfun-ai/step-3.7-flash',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/moonshotai/kimi-k2.6',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/mistralai/mistral-medium-3.5-128b',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/deepseek-ai/deepseek-v4-flash',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/deepseek-ai/deepseek-v4-pro',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/z-ai/glm-5.1',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/minimaxai/minimax-m2.7',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/google/gemma-4-31b-it',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/mistralai/mistral-small-4-119b-2603',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/nemotron-3-super-120b-a12b',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/qwen/qwen3.5-122b-a10b',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/qwen/qwen3.5-397b-a17b',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/stepfun-ai/step-3.5-flash',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/meta/llama-4-maverick-17b-128e-instruct',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'nvidia/meta/llama-3.3-70b-instruct',
        provider: 'nvidia',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },

    // ── Anthropic ──
    {
        id: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        pricing: {
            inputUsdPerMillionTokens: 3,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: 'claude-3-5-haiku-20241022',
        provider: 'anthropic',
        pricing: {
            inputUsdPerMillionTokens: 0.8,
            outputUsdPerMillionTokens: 4,
        },
    },

    // ── OpenAI ──
    {
        id: 'gpt-4o',
        provider: 'openai',
        pricing: {
            inputUsdPerMillionTokens: 2.5,
            outputUsdPerMillionTokens: 10,
        },
    },
    {
        id: 'gpt-4o-mini',
        provider: 'openai',
        pricing: {
            inputUsdPerMillionTokens: 0.15,
            outputUsdPerMillionTokens: 0.6,
        },
    },
    {
        id: 'o3-mini',
        provider: 'openai',
        pricing: {
            inputUsdPerMillionTokens: 1.1,
            outputUsdPerMillionTokens: 4.4,
        },
    },

    // ── Groq ──
    {
        id: 'llama-3.3-70b-versatile',
        provider: 'groq',
        pricing: {
            inputUsdPerMillionTokens: 0.59,
            outputUsdPerMillionTokens: 0.79,
        },
    },
    {
        id: 'mixtral-8x7b-32768',
        provider: 'groq',
        pricing: {
            inputUsdPerMillionTokens: 0.24,
            outputUsdPerMillionTokens: 0.24,
        },
    },

    // ── OpenCode Zen (free models) ──
    {
        id: 'opencode/deepseek-v4-flash-free',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'opencode/nemotron-3-ultra-free',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'opencode/minimax-m3-free',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'opencode/mimo-v2.5-free',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },

    // ── OpenCode Zen (paid models) ──
    {
        id: 'opencode/gpt-5.5',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 5,
            outputUsdPerMillionTokens: 30,
        },
    },
    {
        id: 'opencode/gpt-5.4',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 2.5,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: 'opencode/gpt-5.4-mini',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0.75,
            outputUsdPerMillionTokens: 4.5,
        },
    },
    {
        id: 'opencode/gpt-5.4-nano',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0.2,
            outputUsdPerMillionTokens: 1.25,
        },
    },
    {
        id: 'opencode/gpt-5.3-codex',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 1.75,
            outputUsdPerMillionTokens: 14,
        },
    },
    {
        id: 'opencode/gpt-5.2',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 1.75,
            outputUsdPerMillionTokens: 14,
        },
    },
    {
        id: 'opencode/gpt-5.1-codex',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 1.07,
            outputUsdPerMillionTokens: 8.5,
        },
    },
    {
        id: 'opencode/claude-opus-4-6',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 5,
            outputUsdPerMillionTokens: 25,
        },
    },
    {
        id: 'opencode/claude-sonnet-4-6',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 3,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: 'opencode/claude-haiku-4-5',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 5,
        },
    },
    {
        id: 'opencode/gemini-3.5-flash',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 1.5,
            outputUsdPerMillionTokens: 9,
        },
    },
    {
        id: 'opencode/gemini-3.1-pro',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 12,
        },
    },
    {
        id: 'opencode/grok-build-0.1',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 2,
        },
    },
    {
        id: 'opencode/deepseek-v4-flash',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0.14,
            outputUsdPerMillionTokens: 0.28,
        },
    },
    {
        id: 'opencode/kimi-k2.6',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0.95,
            outputUsdPerMillionTokens: 4,
        },
    },
    {
        id: 'opencode/glm-5.1',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 1.4,
            outputUsdPerMillionTokens: 4.4,
        },
    },
    {
        id: 'opencode/qwen3.6-plus',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0.5,
            outputUsdPerMillionTokens: 3,
        },
    },
    {
        id: 'opencode/north-mini-code-free',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'opencode/big-pickle',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'opencode/qwen3.6-plus-free',
        provider: 'opencode',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },

    // ── xAI (Grok) ──
    {
        id: 'xai/grok-3',
        provider: 'xai',
        pricing: {
            inputUsdPerMillionTokens: 3,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: 'xai/grok-3-mini',
        provider: 'xai',
        pricing: {
            inputUsdPerMillionTokens: 0.3,
            outputUsdPerMillionTokens: 0.5,
        },
    },
    {
        id: 'xai/grok-3-fast',
        provider: 'xai',
        pricing: {
            inputUsdPerMillionTokens: 5,
            outputUsdPerMillionTokens: 25,
        },
    },
    {
        id: 'xai/grok-2-1212',
        provider: 'xai',
        pricing: {
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 10,
        },
    },
    {
        id: 'xai/grok-code-fast-1',
        provider: 'xai',
        pricing: {
            inputUsdPerMillionTokens: 0.3,
            outputUsdPerMillionTokens: 0.5,
        },
    },

    // ── MiniMax ──
    {
        id: 'minimax/MiniMax-M3',
        provider: 'minimax',
        pricing: {
            inputUsdPerMillionTokens: 0.3,
            outputUsdPerMillionTokens: 1.2,
        },
    },
    {
        id: 'minimax/MiniMax-M2.7',
        provider: 'minimax',
        pricing: {
            inputUsdPerMillionTokens: 0.3,
            outputUsdPerMillionTokens: 1.2,
        },
    },

    // ── SambaNova ──
    {
        id: 'sambanova/DeepSeek-V3-0324',
        provider: 'sambanova',
        pricing: {
            inputUsdPerMillionTokens: 3,
            outputUsdPerMillionTokens: 4.5,
        },
    },
    {
        id: 'sambanova/Llama-4-Maverick-17B-128E-Instruct',
        provider: 'sambanova',
        pricing: {
            inputUsdPerMillionTokens: 0.63,
            outputUsdPerMillionTokens: 1.8,
        },
    },
    {
        id: 'sambanova/QwQ-32B',
        provider: 'sambanova',
        pricing: {
            inputUsdPerMillionTokens: 0.63,
            outputUsdPerMillionTokens: 1.8,
        },
    },

    // ── SiliconFlow ──
    {
        id: 'siliconflow/Qwen/Qwen3-235B-A22B',
        provider: 'siliconflow',
        pricing: {
            inputUsdPerMillionTokens: 0.07,
            outputUsdPerMillionTokens: 0.28,
        },
    },
    {
        id: 'siliconflow/deepseek-ai/DeepSeek-V3',
        provider: 'siliconflow',
        pricing: {
            inputUsdPerMillionTokens: 0.14,
            outputUsdPerMillionTokens: 0.28,
        },
    },
    {
        id: 'siliconflow/THUDM/GLM-4-9B-Chat',
        provider: 'siliconflow',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },

    // ── DeepInfra ──
    {
        id: 'deepinfra/deepseek-ai/DeepSeek-V3-0324',
        provider: 'deepinfra',
        pricing: {
            inputUsdPerMillionTokens: 0.2,
            outputUsdPerMillionTokens: 0.77,
        },
    },
    {
        id: 'deepinfra/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
        provider: 'deepinfra',
        pricing: {
            inputUsdPerMillionTokens: 0.15,
            outputUsdPerMillionTokens: 0.6,
        },
    },
    {
        id: 'deepinfra/Qwen/Qwen3-235B-A22B-Instruct-2507',
        provider: 'deepinfra',
        pricing: {
            inputUsdPerMillionTokens: 0.09,
            outputUsdPerMillionTokens: 0.1,
        },
    },

    // ── Novita AI ──
    {
        id: 'novita/deepseek/deepseek-v3-0324',
        provider: 'novita',
        pricing: {
            inputUsdPerMillionTokens: 0.27,
            outputUsdPerMillionTokens: 1.12,
        },
    },
    {
        id: 'novita/meta-llama/llama-4-maverick-17b-128e-instruct-fp8',
        provider: 'novita',
        pricing: {
            inputUsdPerMillionTokens: 0.27,
            outputUsdPerMillionTokens: 0.85,
        },
    },
    {
        id: 'novita/qwen/qwen3-235b-a22b-fp8',
        provider: 'novita',
        pricing: {
            inputUsdPerMillionTokens: 0.2,
            outputUsdPerMillionTokens: 0.8,
        },
    },

    // ── Nebius ──
    {
        id: 'nebius/Qwen/Qwen3-235B-A22B',
        provider: 'nebius',
        pricing: {
            inputUsdPerMillionTokens: 0.2,
            outputUsdPerMillionTokens: 0.6,
        },
    },
    {
        id: 'nebius/deepseek-ai/DeepSeek-V3-0324',
        provider: 'nebius',
        pricing: {
            inputUsdPerMillionTokens: 0.5,
            outputUsdPerMillionTokens: 1.5,
        },
    },
    {
        id: 'nebius/meta-llama/Llama-4-Maverick-17B-128E-Instruct',
        provider: 'nebius',
        pricing: {
            inputUsdPerMillionTokens: 0.2,
            outputUsdPerMillionTokens: 0.6,
        },
    },

    // ── Cline ──
    {
        id: 'cline/anthropic/claude-3-5-sonnet-20241022',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 3.0,
            outputUsdPerMillionTokens: 15.0,
        },
    },
    {
        id: 'cline/anthropic/claude-3-5-haiku-20241022',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0.8,
            outputUsdPerMillionTokens: 4.0,
        },
    },
    {
        id: 'cline/openai/gpt-4o',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 2.5,
            outputUsdPerMillionTokens: 10.0,
        },
    },
    {
        id: 'cline/openai/gpt-4o-mini',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0.15,
            outputUsdPerMillionTokens: 0.6,
        },
    },
    {
        id: 'cline/google/gemini-2.5-pro',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 1.25,
            outputUsdPerMillionTokens: 3.75,
        },
    },
    {
        id: 'cline/google/gemini-2.5-flash',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0.075,
            outputUsdPerMillionTokens: 0.3,
        },
    },
    {
        id: 'cline/minimax/minimax-m2.5',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'cline/meta-llama/llama-3.1-8b-instruct:free',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'cline/qwen/qwen-2.5-coder-32b-instruct:free',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'cline/google/gemini-2.5-flash:free',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'cline/meta-llama/llama-3-8b-instruct:free',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: 'cline/deepseek/deepseek-r1:free',
        provider: 'cline',
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
] as const satisfies readonly SupportedChatModelDefinition[];

export const REGISTERED_LOCAL_MODELS: SupportedChatModelDefinition[] = [];

export function registerLocalModel(modelId: string) {
    if (!modelId.startsWith('local/')) return;
    if (REGISTERED_LOCAL_MODELS.some((m) => m.id === modelId)) return;
    REGISTERED_LOCAL_MODELS.push({
        id: modelId,
        provider: 'local',
        pricing: {
            inputUsdPerMillionTokens: 0.1,
            outputUsdPerMillionTokens: 0.1,
        },
    });
}

export type SupportedChatModel =
    | (typeof SUPPORTED_CHAT_MODELS)[number]
    | SupportedChatModelDefinition;

export type SupportedChatModelId = string;

export function findSupportedChatModel(
    modelId: string,
): SupportedChatModel | undefined {
    const staticModel = SUPPORTED_CHAT_MODELS.find(
        (model) => model.id === modelId,
    );
    if (staticModel) return staticModel;
    return REGISTERED_LOCAL_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId =
    'nvidia/stepfun-ai/step-3.7-flash';
