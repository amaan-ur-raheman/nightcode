import type { ModelsApiResponse, SupportedProvider } from '@nightcode/shared';
import { PROVIDER_KEYCHAIN_NAMES } from '@nightcode/shared';
import { keychain } from '@nightcode/shared';
import { apiClient } from './api-client';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes client-side

let cachedResult: ModelsApiResponse | null = null;
let fetchPromise: Promise<ModelsApiResponse> | null = null;

/**
 * Collect API keys from the OS keychain for all providers.
 * Returns a map of provider name → API key for providers that have keys configured.
 */
async function collectProviderApiKeys(): Promise<Record<string, string>> {
    const keys: Record<string, string> = { local: 'ollama' };
    if (!keychain.isAvailable()) return keys;

    const entries = Object.entries(PROVIDER_KEYCHAIN_NAMES) as [
        SupportedProvider,
        string,
    ][];

    const results = await Promise.allSettled(
        entries.map(async ([provider, keychainName]) => {
            if (provider === 'local') return { provider, key: 'ollama' };
            const key = await keychain.getKey(keychainName);
            return { provider, key };
        }),
    );

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value.key) {
            keys[result.value.provider] = result.value.key;
        }
    }

    return keys;
}

/**
 * Fetch dynamic models from the server with client-side caching.
 * Sends provider API keys from the OS keychain so the server can list
 * models for auth-gated providers (Together, Fireworks, Cerebras, etc.).
 * Deduplicates concurrent requests.
 */
export async function fetchDynamicModels(
    forceRefresh = false,
): Promise<ModelsApiResponse> {
    if (
        !forceRefresh &&
        cachedResult &&
        Date.now() - cachedResult.fetchedAt < CACHE_TTL_MS
    ) {
        return cachedResult;
    }

    if (fetchPromise) {
        return fetchPromise;
    }

    fetchPromise = (async () => {
        try {
            const apiKeys = await collectProviderApiKeys();
            const hasKeys = Object.keys(apiKeys).length > 0;

            // Send API keys via x-provider-keys header (JSON object)
            const headers: Record<string, string> = {};
            if (hasKeys) {
                headers['x-provider-keys'] = JSON.stringify(apiKeys);
            }

            // Using raw fetch (not apiClient) to inject x-provider-keys header.
            // The /models endpoint doesn't require auth, so this is safe.
            const res = await fetch(
                `${process.env.API_URL ?? 'http://localhost:3000'}/models`,
                {
                    headers: {
                        ...headers,
                        Accept: 'application/json',
                    },
                },
            );

            if (!res.ok) {
                return {
                    models: [],
                    providers: [],
                    cached: false,
                    fetchedAt: Date.now(),
                };
            }
            const data = (await res.json()) as ModelsApiResponse;
            cachedResult = data;
            return data;
        } catch {
            return {
                models: [],
                providers: [],
                cached: false,
                fetchedAt: Date.now(),
            };
        } finally {
            fetchPromise = null;
        }
    })();

    return fetchPromise;
}
