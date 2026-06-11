export type ModelPricing = {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "nvidia" | "anthropic" | "openai" | "groq" | "opencode";

type SupportedChatModelDefinition = {
    id: string;
    provider: SupportedProvider;
    pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
    // ── NVIDIA NIM ──
    {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        provider: "nvidia",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
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

    // ── Anthropic ──
    {
        id: "claude-sonnet-4-20250514",
        provider: "anthropic",
        pricing: {
            inputUsdPerMillionTokens: 3,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: "claude-3-5-haiku-20241022",
        provider: "anthropic",
        pricing: {
            inputUsdPerMillionTokens: 0.8,
            outputUsdPerMillionTokens: 4,
        },
    },

    // ── OpenAI ──
    {
        id: "gpt-4o",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 2.5,
            outputUsdPerMillionTokens: 10,
        },
    },
    {
        id: "gpt-4o-mini",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 0.15,
            outputUsdPerMillionTokens: 0.6,
        },
    },
    {
        id: "o3-mini",
        provider: "openai",
        pricing: {
            inputUsdPerMillionTokens: 1.1,
            outputUsdPerMillionTokens: 4.4,
        },
    },

    // ── Groq ──
    {
        id: "llama-3.3-70b-versatile",
        provider: "groq",
        pricing: {
            inputUsdPerMillionTokens: 0.59,
            outputUsdPerMillionTokens: 0.79,
        },
    },
    {
        id: "mixtral-8x7b-32768",
        provider: "groq",
        pricing: {
            inputUsdPerMillionTokens: 0.24,
            outputUsdPerMillionTokens: 0.24,
        },
    },

    // ── OpenCode Zen (free models) ──
    {
        id: "opencode/deepseek-v4-flash-free",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "opencode/nemotron-3-ultra-free",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "opencode/minimax-m3-free",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "opencode/mimo-v2.5-free",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },

    // ── OpenCode Zen (paid models) ──
    {
        id: "opencode/gpt-5.5",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 5,
            outputUsdPerMillionTokens: 30,
        },
    },
    {
        id: "opencode/gpt-5.4",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 2.5,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: "opencode/gpt-5.4-mini",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0.75,
            outputUsdPerMillionTokens: 4.5,
        },
    },
    {
        id: "opencode/gpt-5.4-nano",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0.2,
            outputUsdPerMillionTokens: 1.25,
        },
    },
    {
        id: "opencode/gpt-5.3-codex",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 1.75,
            outputUsdPerMillionTokens: 14,
        },
    },
    {
        id: "opencode/gpt-5.2",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 1.75,
            outputUsdPerMillionTokens: 14,
        },
    },
    {
        id: "opencode/gpt-5.1-codex",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 1.07,
            outputUsdPerMillionTokens: 8.5,
        },
    },
    {
        id: "opencode/claude-opus-4-6",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 5,
            outputUsdPerMillionTokens: 25,
        },
    },
    {
        id: "opencode/claude-sonnet-4-6",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 3,
            outputUsdPerMillionTokens: 15,
        },
    },
    {
        id: "opencode/claude-haiku-4-5",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 5,
        },
    },
    {
        id: "opencode/gemini-3.5-flash",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 1.5,
            outputUsdPerMillionTokens: 9,
        },
    },
    {
        id: "opencode/gemini-3.1-pro",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 12,
        },
    },
    {
        id: "opencode/grok-build-0.1",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 2,
        },
    },
    {
        id: "opencode/deepseek-v4-flash",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0.14,
            outputUsdPerMillionTokens: 0.28,
        },
    },
    {
        id: "opencode/kimi-k2.6",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0.95,
            outputUsdPerMillionTokens: 4,
        },
    },
    {
        id: "opencode/glm-5.1",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 1.4,
            outputUsdPerMillionTokens: 4.4,
        },
    },
    {
        id: "opencode/qwen3.6-plus",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0.5,
            outputUsdPerMillionTokens: 3,
        },
    },
    {
        id: "opencode/north-mini-code-free",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "opencode/big-pickle",
        provider: "opencode",
        pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 0,
        },
    },
    {
        id: "opencode/qwen3.6-plus-free",
        provider: "opencode",
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
