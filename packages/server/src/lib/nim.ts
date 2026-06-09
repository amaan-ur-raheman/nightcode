import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const providerCache = new Map<string, ReturnType<typeof createOpenAICompatible>>();

function getOrCreateProvider(apiKey: string) {
    let provider = providerCache.get(apiKey);
    if (!provider) {
        provider = createOpenAICompatible({
            name: "nim",
            baseURL: "https://integrate.api.nvidia.com/v1",
            apiKey,
        });
        providerCache.set(apiKey, provider);
    }
    return provider;
}

export function nim(modelId: string) {
    const apiKey = process.env.NIM_API_KEY;
    if (!apiKey) throw new Error("NIM_API_KEY environment variable is not set");
    return getOrCreateProvider(apiKey)(modelId);
}

export function nimSubagent(modelId: string) {
    const apiKey = process.env.NIM_API_KEY_SUBAGENT ?? process.env.NIM_API_KEY;
    if (!apiKey) throw new Error("NIM_API_KEY environment variable is not set");
    return getOrCreateProvider(apiKey)(modelId);
}
