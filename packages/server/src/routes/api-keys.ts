import { Hono } from 'hono';
import { keychain } from '@nightcode/shared';
import type { AuthenticatedEnv } from '../middleware/require-auth';

/**
 * Simplified API keys route — status check only.
 * API keys are now stored and managed client-side via the OS keychain.
 * The server no longer stores or writes API keys.
 */

const app = new Hono<AuthenticatedEnv>().get('/status', async (c) => {
    try {
        if (!keychain.isAvailable()) {
            return c.json({ available: false });
        }

        return c.json({ available: true });
    } catch {
        return c.json({ error: 'Internal server error' }, 500);
    }
});

export default app;
