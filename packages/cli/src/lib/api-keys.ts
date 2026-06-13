import {
    keychain,
    PROVIDER_KEYCHAIN_NAMES,
    type SupportedProvider,
} from '@nightcode/shared';

export type ApiKeyStatusResponse = {
    available: boolean;
    providers?: Record<string, boolean>;
};

export type SetApiKeyResponse = {
    success: boolean;
    provider: string;
};

/**
 * Check which providers have API keys configured in the OS keychain.
 * Now reads directly from the client's keychain — no server round-trip.
 */
export async function getApiKeyStatus(): Promise<ApiKeyStatusResponse> {
    if (!keychain.isAvailable()) {
        return { available: false };
    }

    try {
        const statuses: Record<string, boolean> = {};
        for (const [provider, keychainName] of Object.entries(
            PROVIDER_KEYCHAIN_NAMES,
        )) {
            if (provider === 'local') {
                statuses[provider] = true;
            } else {
                const key = await keychain.getKey(keychainName);
                statuses[provider] = key !== null;
            }
        }
        return { available: true, providers: statuses };
    } catch {
        return { available: false };
    }
}

/**
 * Store an API key for a provider in the OS keychain.
 * Now writes directly to the client's keychain — no server round-trip.
 */
export async function setApiKey(
    provider: string,
    apiKey: string,
): Promise<SetApiKeyResponse | null> {
    const keychainName = PROVIDER_KEYCHAIN_NAMES[provider as SupportedProvider];
    if (!keychainName) {
        return null;
    }

    if (!keychain.isAvailable()) {
        return null;
    }

    try {
        const success = await keychain.setKey(keychainName, apiKey);
        if (success) {
            return { success: true, provider };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get the API key for a specific provider from the OS keychain.
 * Used by the API client to attach the key to outgoing requests.
 */
export async function getApiKeyForProvider(
    provider: SupportedProvider,
): Promise<string | null> {
    if (provider === 'local') return 'ollama';
    if (!keychain.isAvailable()) return null;

    const keychainName = PROVIDER_KEYCHAIN_NAMES[provider];
    if (!keychainName) return null;

    try {
        return await keychain.getKey(keychainName);
    } catch {
        return null;
    }
}

/**
 * Delete the API key for a provider from the OS keychain.
 */
export async function deleteApiKey(provider: string): Promise<boolean> {
    const keychainName = PROVIDER_KEYCHAIN_NAMES[provider as SupportedProvider];
    if (!keychainName || !keychain.isAvailable()) {
        return false;
    }

    try {
        return await keychain.deleteKey(keychainName);
    } catch {
        return false;
    }
}
