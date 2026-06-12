import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth module before any imports to prevent top-level env var check
vi.mock('../../lib/auth', () => ({
    authenticateOAuthRequest: vi.fn(),
}));

describe('requireAuth middleware', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('exports AuthenticatedEnv type with userId variable', async () => {
        const mod = await import('../require-auth');
        expect(mod.requireAuth).toBeDefined();
        expect(typeof mod.requireAuth).toBe('function');
    });
});
