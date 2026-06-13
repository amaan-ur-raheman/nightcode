import { hc } from 'hono/client';
import type { AppType } from '@nightcode/server';

import { clearAuth, getAuth, refreshAccessToken, isTokenExpired } from './auth';

/**
 * Track whether an orchestration is active.
 * When true, we don't auto-clear auth on 401 to avoid disrupting running workers.
 */
let orchestrationActive = false;

export function setOrchestrationActive(active: boolean) {
    orchestrationActive = active;
}

/**
 * Callback for auth expiration notifications.
 * Set this from the UI layer to show toast messages.
 */
let onAuthExpired: (() => void) | null = null;

export function setOnAuthExpired(callback: (() => void) | null) {
    onAuthExpired = callback;
}

/**
 * Track if a refresh is in progress to avoid concurrent refresh attempts.
 */
let refreshPromise: Promise<boolean> | null = null;

/**
 * Attempt to refresh the access token. Returns true if successful.
 */
async function tryRefreshToken(): Promise<boolean> {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        try {
            const newAuth = await refreshAccessToken();
            return newAuth !== null;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

/**
 * Ensure we have a valid token, refreshing proactively if needed.
 * Returns the token or null if unavailable.
 */
async function ensureValidToken(): Promise<string | null> {
    const auth = getAuth();
    if (!auth) return null;

    // Proactively refresh if token is about to expire
    if (isTokenExpired()) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
            return getAuth()?.token ?? null;
        }
        // If refresh failed, return the existing token and let the server reject it
    }

    return auth.token;
}

export const apiClient = hc<AppType>(
    process.env.API_URL ?? 'http://localhost:3000',
    {
        fetch: async (
            input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ) => {
            const headers = new Headers(init?.headers);
            const token = await ensureValidToken();

            if (token) {
                headers.set('Authorization', `Bearer ${token}`);
            }

            const MAX_RETRIES = 3;
            const RETRY_DELAY_MS = 1000;
            const method = (init?.method ?? 'GET').toUpperCase();
            const isIdempotent = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
            let response: Response | null = null;
            let lastError: Error | null = null;

            const maxAttempts = isIdempotent ? MAX_RETRIES + 1 : 1;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                try {
                    response = await fetch(input, { ...init, headers });
                    // Retry on server errors (502, 503, 504) but not on client errors (4xx)
                    if (
                        isIdempotent &&
                        response.status >= 502 &&
                        response.status <= 504 &&
                        attempt < MAX_RETRIES
                    ) {
                        await new Promise((r) =>
                            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
                        );
                        continue;
                    }
                    break;
                } catch (err) {
                    lastError =
                        err instanceof Error ? err : new Error(String(err));
                    if (isIdempotent && attempt < MAX_RETRIES) {
                        await new Promise((r) =>
                            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
                        );
                        continue;
                    }
                }
            }

            if (!response) {
                throw lastError ?? new Error('Network request failed');
            }

            // On 401, attempt token refresh before giving up
            if (response.status === 401) {
                const refreshed = await tryRefreshToken();

                if (refreshed) {
                    // Retry with the new token
                    const newAuth = getAuth();
                    if (newAuth) {
                        const retryHeaders = new Headers(init?.headers);
                        retryHeaders.set(
                            'Authorization',
                            `Bearer ${newAuth.token}`,
                        );
                        try {
                            response = await fetch(input, {
                                ...init,
                                headers: retryHeaders,
                            });
                        } catch {
                            // Fall through with the original 401 response
                        }
                    }
                }

                // If still 401 after refresh attempt, clear auth and notify if orchestration is NOT active
                if (response.status === 401 && !orchestrationActive) {
                    clearAuth();
                    onAuthExpired?.();
                }
            }

            return response;
        },
    },
);
