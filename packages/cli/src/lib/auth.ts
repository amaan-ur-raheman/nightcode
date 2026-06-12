import { join } from 'node:path';
import { homedir } from 'node:os';
import {
    readFileSync,
    existsSync,
    mkdirSync,
    writeFileSync,
    unlinkSync,
    statSync,
} from 'node:fs';

export type AuthData = {
    token: string;
    refreshToken?: string;
    expiresAt?: number; // Unix timestamp in milliseconds
};

const AUTH_DIR = join(homedir(), '.nightcode');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');

let _cachedAuth: AuthData | null = null;
let _cachedMtime: number = 0;

export function getAuth(): AuthData | null {
    try {
        const stat = statSync(AUTH_FILE);
        const mtimeMs = stat.mtimeMs;

        if (_cachedAuth && mtimeMs === _cachedMtime) {
            return _cachedAuth;
        }

        const data = readFileSync(AUTH_FILE, 'utf-8');
        const parsed = JSON.parse(data) as Partial<AuthData>;

        _cachedAuth =
            typeof parsed.token === 'string'
                ? {
                      token: parsed.token,
                      refreshToken: parsed.refreshToken,
                      expiresAt: parsed.expiresAt,
                  }
                : null;
        _cachedMtime = mtimeMs;
        return _cachedAuth;
    } catch {
        _cachedAuth = null;
        _cachedMtime = 0;
        return null;
    }
}

export function saveAuth(data: AuthData): void {
    if (!existsSync(AUTH_DIR)) {
        // Owner only permission (rwx------) so other users on the machine cannot read tokens
        mkdirSync(AUTH_DIR, { mode: 0o700 });
    }

    writeFileSync(AUTH_FILE, JSON.stringify(data), { mode: 0o600 });
    _cachedAuth = data;
    try {
        _cachedMtime = statSync(AUTH_FILE).mtimeMs;
    } catch {
        /* ignore */
    }
}

export function clearAuth() {
    try {
        unlinkSync(AUTH_FILE);
    } catch {
        // File may not exist, ignore error
    }
    _cachedAuth = null;
    _cachedMtime = 0;
}

/**
 * Check if the current token is expired or will expire soon (within 60 seconds).
 */
export function isTokenExpired(): boolean {
    const auth = getAuth();
    if (!auth?.expiresAt) return false; // No expiry info means we can't check
    // Consider expired if within 60 seconds of expiry
    return Date.now() >= auth.expiresAt - 60_000;
}

/**
 * Refresh the OAuth access token using the stored refresh token.
 * Returns the new auth data or null if refresh fails.
 */
export async function refreshAccessToken(): Promise<AuthData | null> {
    const auth = getAuth();
    if (!auth?.refreshToken) return null;

    const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
    const clientId = process.env.CLERK_OAUTH_CLIENT_ID;

    if (!clerkFrontendApi || !clientId) return null;

    try {
        const response = await fetch(`${clerkFrontendApi}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: auth.refreshToken,
                client_id: clientId,
            }),
        });

        if (!response.ok) {
            return null;
        }

        const tokenData = (await response.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };

        const newAuth: AuthData = {
            token: tokenData.access_token,
            refreshToken: tokenData.refresh_token ?? auth.refreshToken,
            expiresAt: tokenData.expires_in
                ? Date.now() + tokenData.expires_in * 1000
                : undefined,
        };

        saveAuth(newAuth);
        return newAuth;
    } catch {
        return null;
    }
}

/**
 * Get a valid auth token, refreshing proactively if needed.
 * Returns the auth data or null if unavailable.
 * This is the recommended way to get the token for direct API calls.
 */
export async function getValidAuth(): Promise<AuthData | null> {
    const auth = getAuth();
    if (!auth) return null;

    // Proactively refresh if token is about to expire
    if (isTokenExpired()) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
            return getAuth();
        }
        // If refresh failed, return the existing token and let the server reject it
    }

    return auth;
}
