import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('require-credits-balance middleware', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('exports requireCreditsBalance function', async () => {
        const mod = await import('../require-credits-balance');
        expect(mod.requireCreditsBalance).toBeDefined();
        expect(typeof mod.requireCreditsBalance).toBe('function');
    });
});
