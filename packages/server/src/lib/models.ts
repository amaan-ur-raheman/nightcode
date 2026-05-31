import type { LanguageModel } from "ai";

import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
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
};

function assertUnsupportedProvider(provider: never): never {
    throw new Error(`Unsupported provider: ${provider}`);
}

function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
    return {
        model: anthropic(modelId),
        provider: "anthropic",
        modelId,
    };
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
    return {
        model: openai(modelId),
        provider: "openai",
        modelId,
    };
}

function resolveNimModel(modelId: NimModelId): ResolvedModel {
    return {
        model: nim(modelId),
        provider: "nvidia",
        modelId,
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