import type { LanguageModelUsage } from 'ai';
import {
    findSupportedChatModel,
    type ModelPricing,
} from '@nightcode/shared';

type CalculateCreditsForUsageParams = {
    provider: string;
    model: string;
    usage: LanguageModelUsage;
};

type BillableUsage = {
    credits: number;
};

type TokenCounts = {
    inputTokens: number;
    outputTokens: number;
};

const TOKENS_PER_MILLION = 1_000_000;
const USD_PER_CREDIT = 0.01;

function getTokenCounts(usage: LanguageModelUsage): TokenCounts {
    const inputTokens = usage.inputTokens;
    const outputTokens = usage.outputTokens;

    if (
        inputTokens == null ||
        outputTokens == null ||
        !Number.isFinite(inputTokens) ||
        !Number.isFinite(outputTokens) ||
        !Number.isInteger(inputTokens) ||
        !Number.isInteger(outputTokens) ||
        inputTokens < 0 ||
        outputTokens < 0
    ) {
        throw new Error(
            'Credits conversion requires input and output token counts',
        );
    }

    return {
        inputTokens,
        outputTokens,
    };
}

function getModelPricing(provider: string, model: string): ModelPricing {
    const supportedModel = findSupportedChatModel(model);

    if (supportedModel && supportedModel.provider === provider) {
        return supportedModel.pricing;
    }

    // Default pricing for dynamic models (0 cost until we have pricing data)
    return {
        inputUsdPerMillionTokens: 0,
        outputUsdPerMillionTokens: 0,
    };
}

function estimateCostsUsd(
    { inputTokens, outputTokens }: TokenCounts,
    pricing: ModelPricing,
) {
    return (
        (inputTokens * pricing.inputUsdPerMillionTokens +
            outputTokens * pricing.outputUsdPerMillionTokens) /
        TOKENS_PER_MILLION
    );
}

function convertUsdToCredits(estimatedCostUsd: number) {
    if (estimatedCostUsd <= 0) {
        return 0;
    }

    return Math.max(1, Math.ceil(estimatedCostUsd / USD_PER_CREDIT));
}

export function calculateCreditsForUsage({
    provider,
    model,
    usage,
}: CalculateCreditsForUsageParams): BillableUsage {
    const tokenCounts = getTokenCounts(usage);
    const pricing = getModelPricing(provider, model);
    const estimatedCostUsd = estimateCostsUsd(tokenCounts, pricing);
    const credits = convertUsdToCredits(estimatedCostUsd);

    return {
        credits,
    };
}
