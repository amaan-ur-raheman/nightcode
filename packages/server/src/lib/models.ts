import type { LanguageModel } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import {
    findSupportedChatModel,
    type SupportedChatModel,
    type SupportedChatModelId,
    type SupportedProvider,
} from '@nightcode/shared';

import { nim, nimSubagent } from './nim';
import { getProviderClient, getProviderName, isZenModelId } from './providers';
import { requestQueue } from './request-queue';

type NimModelId = Extract<SupportedChatModel, { provider: 'nvidia' }>['id'];

export type ResolvedModel = {
    model: LanguageModel;
    provider: SupportedProvider;
    modelId: string;
    providerOptions?: ProviderOptions;
};

const NIM_PROVIDER_OPTIONS: Partial<Record<NimModelId, ProviderOptions>> = {
    'nvidia/nemotron-3-ultra-550b-a55b': {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    'nvidia/deepseek-ai/deepseek-v4-pro': {
        nim: { chat_template_kwargs: { thinking: true } },
    },
    'nvidia/deepseek-ai/deepseek-v4-flash': {
        nim: { chat_template_kwargs: { thinking: true } },
    },
    'nvidia/qwen/qwen3.5-397b-a17b': {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    'nvidia/qwen/qwen3.5-122b-a10b': {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    'nvidia/moonshotai/kimi-k2.6': {
        nim: { chat_template_kwargs: { thinking: true } },
    },
    'nvidia/stepfun-ai/step-3.7-flash': {
        nim: { reasoning_effort: 'medium' },
    },
    'nvidia/stepfun-ai/step-3.5-flash': {
        nim: { reasoning_effort: 'medium' },
    },
    'nvidia/mistralai/mistral-medium-3.5-128b': {
        nim: { reasoning_effort: 'high' },
    },
    'nvidia/mistralai/mistral-small-4-119b-2603': {
        nim: { reasoning_effort: 'high' },
    },
    'nvidia/minimaxai/minimax-m2.7': {
        nim: { reasoning_effort: 'high' },
    },
    'nvidia/z-ai/glm-5.1': {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
    'nvidia/google/gemma-4-31b-it': {
        nim: { chat_template_kwargs: { enable_thinking: true } },
    },
};

function wrapWithQueue(model: LanguageModelV3): LanguageModel {
    return {
        ...model,
        doGenerate: async (params: any): Promise<any> =>
            await requestQueue.enqueue(() =>
                Promise.resolve(model.doGenerate(params)),
            ),
        doStream: async (params: any): Promise<any> =>
            await requestQueue.enqueue(() =>
                Promise.resolve(model.doStream(params)),
            ),
    } as any;
}

async function resolveNimModel(
    modelId: NimModelId,
    subagent = false,
    apiKey?: string,
): Promise<ResolvedModel> {
    const rawModel = subagent
        ? await nimSubagent(modelId, apiKey)
        : await nim(modelId, apiKey);
    return {
        model: subagent ? rawModel : wrapWithQueue(rawModel),
        provider: 'nvidia',
        modelId,
        providerOptions: NIM_PROVIDER_OPTIONS[modelId],
    };
}

async function resolveThirdPartyModel(
    model: SupportedChatModel,
    subagent = false,
    apiKey?: string,
): Promise<ResolvedModel> {
    const client = await getProviderClient(model.id, apiKey);
    return {
        model: subagent ? client : wrapWithQueue(client),
        provider: model.provider,
        modelId: model.id,
    };
}

async function resolveSupportedChatModel(
    model: SupportedChatModel,
    subagent = false,
    apiKey?: string,
): Promise<ResolvedModel> {
    const provider: SupportedProvider = model.provider as SupportedProvider;

    switch (provider) {
        case 'nvidia':
            return resolveNimModel(model.id as NimModelId, subagent, apiKey);
        case 'opencode':
        case 'anthropic':
        case 'openai':
        case 'groq':
        case 'openrouter':
        case 'together':
        case 'fireworks':
        case 'cerebras':
        case 'deepseek':
        case 'gemini':
        case 'kilo':
            return resolveThirdPartyModel(model, subagent, apiKey);
        default:
            const _exhaustive: never = provider;
            throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
}

export function isSupportedChatModel(
    modelId: string,
): modelId is SupportedChatModelId {
    return findSupportedChatModel(modelId) !== undefined;
}

function normalizeModelId(modelId: string): string {
    // If already has a known prefix, return as-is
    if (
        modelId.startsWith('nvidia/') ||
        modelId.startsWith('opencode/') ||
        modelId.startsWith('openrouter/') ||
        modelId.startsWith('together/') ||
        modelId.startsWith('fireworks/') ||
        modelId.startsWith('cerebras/') ||
        modelId.startsWith('deepseek/') ||
        modelId.startsWith('gemini/') ||
        modelId.startsWith('google/') ||
        modelId.startsWith('kilo/')
    ) {
        return modelId;
    }

    // Zen model IDs don't have a prefix in the API (e.g., "mimo-v2.5-free")
    // Try adding opencode/ prefix
    const zenCandidate = `opencode/${modelId}`;
    if (findSupportedChatModel(zenCandidate)) {
        return zenCandidate;
    }

    // Check if it's a known Zen model name (without prefix)
    if (isZenModelId(modelId)) {
        return zenCandidate;
    }

    return modelId;
}

export async function resolveChatModel(
    modelId: string,
    apiKey?: string,
): Promise<ResolvedModel> {
    const normalized = normalizeModelId(modelId);

    // Try hardcoded models first
    const model = findSupportedChatModel(normalized);
    if (model) {
        return resolveSupportedChatModel(model, false, apiKey);
    }

    // Try dynamic provider resolution
    const client = await getProviderClient(normalized, apiKey);
    const provider = getProviderName(normalized);
    return {
        model: wrapWithQueue(client),
        provider: provider as SupportedProvider,
        modelId: normalized,
    };
}

export async function resolveSubagentChatModel(
    modelId: string,
    apiKey?: string,
): Promise<ResolvedModel> {
    const normalized = normalizeModelId(modelId);

    // Try hardcoded models first
    const model = findSupportedChatModel(normalized);
    if (model) {
        return resolveSupportedChatModel(model, true, apiKey);
    }

    // Try dynamic provider resolution
    const client = await getProviderClient(normalized, apiKey);
    const provider = getProviderName(normalized);
    return {
        model: client,
        provider: provider as SupportedProvider,
        modelId: normalized,
    };
}
