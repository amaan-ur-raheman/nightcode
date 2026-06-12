import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { keychain } from '@nightcode/shared';

const providerCache = new Map<
    string,
    ReturnType<typeof createOpenAICompatible>
>();

function getOrCreateProvider(apiKey: string) {
    let provider = providerCache.get(apiKey);
    if (!provider) {
        provider = createOpenAICompatible({
            name: 'nim',
            baseURL: 'https://integrate.api.nvidia.com/v1',
            apiKey,
        });
        providerCache.set(apiKey, provider);
    }
    return provider;
}

async function resolveNimKey(
    envVar: string,
    keychainName: string,
): Promise<string> {
    if (keychain.isAvailable()) {
        const key = await keychain.getKey(keychainName);
        if (key) return key;
    }
    return process.env[envVar] ?? '';
}

function stripNvidiaPrefix(modelId: string): string {
    // NIM model IDs use "nvidia/{org}/{model}" format (e.g., "nvidia/google/gemma-4-31b-it")
    // NVIDIA API expects the raw "{org}/{model}" format
    return modelId.startsWith('nvidia/')
        ? modelId.slice('nvidia/'.length)
        : modelId;
}

export async function nim(modelId: string, apiKey?: string) {
    const resolvedKey =
        apiKey || (await resolveNimKey('NIM_API_KEY', 'nim-api-key'));
    if (!resolvedKey)
        throw new Error('NIM_API_KEY not found in environment or keychain');
    const apiModelId = stripNvidiaPrefix(modelId);
    return getOrCreateProvider(resolvedKey)(apiModelId);
}

export async function nimSubagent(modelId: string, apiKey?: string) {
    const subagentKey = await resolveNimKey(
        'NIM_API_KEY_SUBAGENT',
        'nim-api-key-subagent',
    );
    const resolvedKey =
        apiKey ||
        subagentKey ||
        (await resolveNimKey('NIM_API_KEY', 'nim-api-key'));
    if (!resolvedKey)
        throw new Error('NIM_API_KEY not found in environment or keychain');
    const apiModelId = stripNvidiaPrefix(modelId);
    return getOrCreateProvider(resolvedKey)(apiModelId);
}
