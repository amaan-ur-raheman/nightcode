export type ModelPricing = {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "anthropic" | "openai" | "nvidia";

type SupportedChatModelDefinition = {
    id: string;
    provider: SupportedProvider;
    pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
    {
        id: "claude-sonnet-4-6",
        provider: "anthropic",
        pricing: {
            inputUsdPerMillionTokens: 3,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: "claude-haiku-4-5",
        provider: "anthropic",
        pricing: {
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 5,
        },
    },
    {
        id: "claude-opus-4-6",
        provider: "anthropic",
        pricing: {
            inputUsdPerMillionTokens: 5,
            outputUsdPerMillionTokens: 25,
        },
    },
    {
        id: "gpt-5.4",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 2.5,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: "gpt-5.4-mini",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 0.75,
            outputUsdPerMillionTokens: 4.5,
        },
    },
    {
        id: "gpt-5.4-nano",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 0.2,
            outputUsdPerMillionTokens: 1.25,
        },
    },
    {
        id: "stepfun-ai/step-3.7-flash",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "moonshotai/kimi-k2.6",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "mistralai/mistral-medium-3.5-128b",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "deepseek-ai/deepseek-v4-flash",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "deepseek-ai/deepseek-v4-pro",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "z-ai/glm-5.1",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "minimaxai/minimax-m2.7",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "google/gemma-4-31b-it",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "mistralai/mistral-small-4-119b-2603",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "nvidia/nemotron-3-super-120b-a12b",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "qwen/qwen3.5-122b-a10b",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "qwen/qwen3.5-397b-a17b",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "stepfun-ai/step-3.5-flash",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "meta/llama-3.3-70b-instruct",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
