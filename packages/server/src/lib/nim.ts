import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { keychain } from "@nightcode/shared";

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

async function resolveNimKey(envVar: string, keychainName: string): Promise<string> {
    if (keychain.isAvailable()) {
        const key = await keychain.getKey(keychainName);
        if (key) return key;
    }
    return process.env[envVar] ?? "";
}

export async function nim(modelId: string) {
    const apiKey = await resolveNimKey("NIM_API_KEY", "nim-api-key");
    if (!apiKey) throw new Error("NIM_API_KEY not found in environment or keychain");
    return getOrCreateProvider(apiKey)(modelId);
}

export async function nimSubagent(modelId: string) {
    const subagentKey = await resolveNimKey("NIM_API_KEY_SUBAGENT", "nim-api-key-subagent");
    const apiKey = subagentKey || await resolveNimKey("NIM_API_KEY", "nim-api-key");
    if (!apiKey) throw new Error("NIM_API_KEY not found in environment or keychain");
    return getOrCreateProvider(apiKey)(modelId);
}
