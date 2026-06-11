import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { keychain } from "@nightcode/shared";

const ZEN_BASE_URL = "https://opencode.ai/zen";

type ZenSdkType = "openai" | "anthropic" | "google" | "openai-compatible";

const providerCache = new Map<string, ReturnType<typeof createOpenAICompatible> | ReturnType<typeof createOpenAI> | ReturnType<typeof createAnthropic> | ReturnType<typeof createGoogleGenerativeAI>>();

function resolveSdkType(modelId: string): ZenSdkType {
    // Strip the "opencode/" prefix if present
    const id = modelId.startsWith("opencode/") ? modelId.slice("opencode/".length) : modelId;

    if (id.startsWith("gpt-")) return "openai";
    if (id.startsWith("claude-")) return "anthropic";
    if (id.startsWith("gemini-")) return "google";
    return "openai-compatible";
}

function getOrCreateProvider(sdkType: ZenSdkType, apiKey: string) {
    const cacheKey = `${sdkType}:${apiKey}`;
    const cached = providerCache.get(cacheKey);
    if (cached) return cached;

    let provider: ReturnType<typeof createOpenAICompatible> | ReturnType<typeof createOpenAI> | ReturnType<typeof createAnthropic> | ReturnType<typeof createGoogleGenerativeAI>;

    switch (sdkType) {
        case "openai":
            provider = createOpenAI({
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
        case "anthropic":
            provider = createAnthropic({
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
        case "google":
            provider = createGoogleGenerativeAI({
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
        case "openai-compatible":
        default:
            provider = createOpenAICompatible({
                name: "opencode-zen",
                baseURL: `${ZEN_BASE_URL}/v1`,
                apiKey,
            });
            break;
    }

    providerCache.set(cacheKey, provider);
    return provider;
}

async function resolveZenKey(): Promise<string> {
    if (keychain.isAvailable()) {
        const key = await keychain.getKey("opencode-api-key");
        if (key) return key;
    }
    return process.env.OPENCODE_API_KEY ?? "";
}

/**
 * Resolve an OpenCode Zen model to a LanguageModel instance.
 * Routes to the correct AI SDK based on model family.
 */
export async function zen(modelId: string): Promise<LanguageModelV3> {
    const apiKey = await resolveZenKey();
    if (!apiKey) {
        throw new Error(
            "OPENCODE_API_KEY not found in environment or keychain. " +
            "Get your key at https://opencode.ai/auth"
        );
    }

    // Strip "opencode/" prefix for the actual API call
    const apiModelId = modelId.startsWith("opencode/") ? modelId.slice("opencode/".length) : modelId;
    const sdkType = resolveSdkType(modelId);
    const provider = getOrCreateProvider(sdkType, apiKey);

    // Each SDK type returns a provider we call with the model ID
    return (provider as any)(apiModelId) as LanguageModelV3;
}

/**
 * Check if an OpenCode Zen model ID belongs to this provider.
 */
export function isZenModel(modelId: string): boolean {
    return modelId.startsWith("opencode/");
}

/**
 * Get the SDK type for a Zen model (useful for provider-specific options).
 */
export function getZenSdkType(modelId: string): ZenSdkType {
    return resolveSdkType(modelId);
}
