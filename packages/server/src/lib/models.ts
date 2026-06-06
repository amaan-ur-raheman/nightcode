import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
    findSupportedChatModel,
    type SupportedChatModel,
    type SupportedChatModelId,
    type SupportedProvider,
} from "@nightcode/shared";

import { nim, nimSubagent } from "./nim";

type NimModelId = Extract<SupportedChatModel, { provider: "nvidia" }>["id"];

export type ResolvedModel = {
    model: LanguageModel,
    provider: SupportedProvider,
    modelId: SupportedChatModelId,
    providerOptions?: ProviderOptions,
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

function resolveNimModel(modelId: NimModelId, subagent = false): ResolvedModel {
    return {
        model: subagent ? nimSubagent(modelId) : nim(modelId),
        provider: "nvidia",
        modelId,
        providerOptions: NIM_PROVIDER_OPTIONS[modelId],
    };
}

function resolveSupportedChatModel(model: SupportedChatModel, subagent = false): ResolvedModel {
    const provider = model.provider;

    switch (provider) {
        case "nvidia":
            return resolveNimModel(model.id, subagent);
        default:
            return assertUnsupportedProvider(provider);
    }
}

export function isSupportedChatModel(modelId: string): modelId is SupportedChatModelId {
    return findSupportedChatModel(modelId) !== undefined;
}

export function resolveChatModel(modelId: string): ResolvedModel {
    const model = findSupportedChatModel(modelId);
    if (!model) throw new Error(`Unsupported model: ${modelId}`);
    return resolveSupportedChatModel(model);
}

export function resolveSubagentChatModel(modelId: string): ResolvedModel {
    const model = findSupportedChatModel(modelId);
    if (!model) throw new Error(`Unsupported model: ${modelId}`);
    return resolveSupportedChatModel(model, true);
}
