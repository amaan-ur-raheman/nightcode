import type { LanguageModel } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
    findSupportedChatModel,
    type SupportedChatModel,
    type SupportedChatModelId,
    type SupportedProvider,
} from "@nightcode/shared";

import { nim, nimSubagent } from "./nim";
import { getProviderClient, getProviderName } from "./providers";
import { requestQueue } from "./request-queue";

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

function wrapWithQueue(model: LanguageModelV3): LanguageModel {
    return {
        ...model,
        doGenerate: async (params: any): Promise<any> => await requestQueue.enqueue(() => Promise.resolve(model.doGenerate(params))),
        doStream: async (params: any): Promise<any> => await requestQueue.enqueue(() => Promise.resolve(model.doStream(params))),
    } as any;
}

async function resolveNimModel(modelId: NimModelId, subagent = false): Promise<ResolvedModel> {
    const rawModel = subagent ? await nimSubagent(modelId) : await nim(modelId);
    return {
        model: subagent ? rawModel : wrapWithQueue(rawModel),
        provider: "nvidia",
        modelId,
        providerOptions: NIM_PROVIDER_OPTIONS[modelId],
    };
}

async function resolveThirdPartyModel(model: SupportedChatModel, subagent = false): Promise<ResolvedModel> {
    const client = await getProviderClient(model.id);
    return {
        model: subagent ? client : wrapWithQueue(client),
        provider: model.provider,
        modelId: model.id,
    };
}

async function resolveSupportedChatModel(model: SupportedChatModel, subagent = false): Promise<ResolvedModel> {
    const provider = model.provider;

    switch (provider) {
        case "nvidia":
            return resolveNimModel(model.id as NimModelId, subagent);
        case "opencode":
        case "anthropic":
        case "openai":
        case "groq":
            return resolveThirdPartyModel(model, subagent);
        default:
            const _exhaustive: never = provider;
            throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
}

export function isSupportedChatModel(modelId: string): modelId is SupportedChatModelId {
    return findSupportedChatModel(modelId) !== undefined;
}

export async function resolveChatModel(modelId: string): Promise<ResolvedModel> {
    const model = findSupportedChatModel(modelId);
    if (!model) throw new Error(`Unsupported model: ${modelId}`);
    return resolveSupportedChatModel(model);
}

export async function resolveSubagentChatModel(modelId: string): Promise<ResolvedModel> {
    const model = findSupportedChatModel(modelId);
    if (!model) throw new Error(`Unsupported model: ${modelId}`);
    return resolveSupportedChatModel(model, true);
}
