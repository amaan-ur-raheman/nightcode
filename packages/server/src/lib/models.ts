import type { LanguageModel } from "ai";

import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
    findSupportedChatModel,
    type SupportedChatModel,
    type SupportedChatModelId,
    type SupportedProvider,
} from "@nightcode/shared";

import { nim } from "./nim";

type AnthropicModelId = Extract<SupportedChatModel, { provider: "anthropic" }>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai" }>["id"];
type NimModelId = Extract<SupportedChatModel, { provider: "nvidia" }>["id"];

export type ResolvedModel = {
    model: LanguageModel,
    provider: SupportedProvider,
    modelId: SupportedChatModelId,
    providerOptions?: ProviderOptions,
};

const ANTHROPIC_PROVIDER_OPTIONS: Partial<Record<AnthropicModelId, ProviderOptions>> = {
    "claude-opus-4-6": {
        anthropic: {
            thinking: {
                type: "enabled",
                budgetTokens: 10000,
            }
        },
    },
    "claude-sonnet-4-6": {
        anthropic: {
            thinking: {
                type: "enabled",
                budgetTokens: 10000,
            },
        },
    },
};

const OPENAI_PROVIDER_OPTIONS: Partial<Record<OpenAIModelId, ProviderOptions>> = {
    "gpt-5.4": {
        openai: {
            thinking: {
                reasoningSummary: "detailed",
            }
        },
    },
};

const NIM_PROVIDER_OPTIONS: Partial<Record<NimModelId, ProviderOptions>> = {
    "nvidia/nemotron-3-ultra-550b-a55b": {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    "deepseek-ai/deepseek-v4-pro": {
        nim: { chat_template_kwargs: { thinking: true } },
    },
    "deepseek-ai/deepseek-v4-flash": {
        nim: { chat_template_kwargs: { thinking: true } },
    },
    "qwen/qwen3.5-397b-a17b": {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    "qwen/qwen3.5-122b-a10b": {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    "moonshotai/kimi-k2.6": {
        nim: { chat_template_kwargs: { thinking: true } },
    },
    "stepfun-ai/step-3.7-flash": {
        nim: { reasoning_effort: "medium" },
    },
    "stepfun-ai/step-3.5-flash": {
        nim: { reasoning_effort: "medium" },
    },
    "mistralai/mistral-medium-3.5-128b": {
        nim: { reasoning_effort: "high" },
    },
    "mistralai/mistral-small-4-119b-2603": {
        nim: { reasoning_effort: "high" },
    },
    "minimaxai/minimax-m2.7": {
        nim: { reasoning_effort: "high" },
    },
    "z-ai/glm-5.1": {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    "google/gemma-4-31b-it": {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
};

function assertUnsupportedProvider(provider: never): never {
    throw new Error(`Unsupported provider: ${provider}`);
}

function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
    return {
        model: anthropic(modelId),
        provider: "anthropic",
        modelId,
        providerOptions: ANTHROPIC_PROVIDER_OPTIONS[modelId],
    };
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
    return {
        model: openai(modelId),
        provider: "openai",
        modelId,
        providerOptions: OPENAI_PROVIDER_OPTIONS[modelId],
    };
}

function resolveNimModel(modelId: NimModelId): ResolvedModel {
    return {
        model: nim(modelId),
        provider: "nvidia",
        modelId,
        providerOptions: NIM_PROVIDER_OPTIONS[modelId],
    };
}

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    const provider = model.provider;

    switch (provider) {
        case "anthropic":
            return resolveAnthropicModel(model.id);
        case "openai":
            return resolveOpenAIModel(model.id);
        case "nvidia":
            return resolveNimModel(model.id);
        default:
            return assertUnsupportedProvider(provider);
    }
}

export function isSupportedChatModel(modelId: string): modelId is SupportedChatModelId {
    return findSupportedChatModel(modelId) !== null;
}

export function resolveChatModel(modelId: string): ResolvedModel {
    const model = findSupportedChatModel(modelId);
    if (!model) {
        throw new Error(`Unsupported model: ${modelId}`);
    }

    return resolveSupportedChatModel(model);
}
