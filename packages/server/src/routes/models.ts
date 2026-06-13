import { Hono } from 'hono';
import { fetchAllModels, clearModelCache } from '../lib/model-fetcher';
import type { AuthenticatedEnv } from '../middleware/require-auth';
import { requireAuth } from '../middleware/require-auth';

const REFRESH_COOLDOWN_MS = 30_000; // 30 seconds between refreshes
let lastRefreshTime = 0;

/**
 * Extract provider API keys from x-provider-keys header.
 * Format: JSON object mapping provider name to API key.
 */
function extractApiKeys(
    header: string | undefined,
): Record<string, string> | undefined {
    if (!header) return undefined;
    try {
        const parsed = JSON.parse(header);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, string>;
        }
    } catch {}
    return undefined;
}

const app = new Hono<AuthenticatedEnv>()
    .get('/', async (c) => {
        const apiKeys = extractApiKeys(c.req.header('x-provider-keys'));
        const result = await fetchAllModels(apiKeys);
        return c.json(result);
    })
    .post('/refresh', requireAuth, async (c) => {
        const now = Date.now();
        if (now - lastRefreshTime < REFRESH_COOLDOWN_MS) {
            return c.json(
                { error: 'Refresh rate limited. Try again in a few seconds.' },
                429,
            );
        }
        lastRefreshTime = now;
        clearModelCache();
        const apiKeys = extractApiKeys(c.req.header('x-provider-keys'));
        const result = await fetchAllModels(apiKeys);
        return c.json(result);
    });

export default app;
