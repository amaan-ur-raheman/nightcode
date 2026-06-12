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

            let response = await fetch(input, { ...init, headers });

            // On 401, attempt token refresh before giving up
            if (response.status === 401 && !orchestrationActive) {
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
                        response = await fetch(input, {
                            ...init,
                            headers: retryHeaders,
                        });
                    }
                }

                // If still 401 after refresh attempt, clear auth and notify
                if (response.status === 401) {
                    clearAuth();
                    onAuthExpired?.();
                }
            }

            return response;
        },
    },
);
