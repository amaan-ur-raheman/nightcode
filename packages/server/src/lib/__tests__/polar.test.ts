import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('polar helpers', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('getPolarAccessToken', () => {
        it('throws when POLAR_ACCESS_TOKEN is not set', async () => {
            delete process.env.POLAR_ACCESS_TOKEN;
            const { getPolarAccessToken } = await import('../polar');
            expect(() => getPolarAccessToken()).toThrow('POLAR_ACCESS_TOKEN');
        });

        it('returns the token when set', async () => {
            process.env.POLAR_ACCESS_TOKEN = 'test-token';
            const { getPolarAccessToken } = await import('../polar');
            expect(getPolarAccessToken()).toBe('test-token');
        });
    });

    describe('getPolarProductId', () => {
        it('throws when POLAR_PRODUCT_ID is not set', async () => {
            delete process.env.POLAR_PRODUCT_ID;
            const { getPolarProductId } = await import('../polar');
            expect(() => getPolarProductId()).toThrow('POLAR_PRODUCT_ID');
        });

        it('returns the product id when set', async () => {
            process.env.POLAR_PRODUCT_ID = 'prod-123';
            const { getPolarProductId } = await import('../polar');
            expect(getPolarProductId()).toBe('prod-123');
        });
    });

    describe('getPolarCreditsMeterId', () => {
        it('throws when POLAR_CREDITS_METER_ID is not set', async () => {
            delete process.env.POLAR_CREDITS_METER_ID;
            const { getPolarCreditsMeterId } = await import('../polar');
            expect(() => getPolarCreditsMeterId()).toThrow(
                'POLAR_CREDITS_METER_ID',
            );
        });
    });

    describe('getPolarServer', () => {
        it('returns sandbox by default', async () => {
            delete process.env.POLAR_SERVER;
            const { getPolarServer } = await import('../polar');
            expect(getPolarServer()).toBe('sandbox');
        });

        it('returns production when set', async () => {
            process.env.POLAR_SERVER = 'production';
            const { getPolarServer } = await import('../polar');
            expect(getPolarServer()).toBe('production');
        });

        it('throws for invalid values', async () => {
            process.env.POLAR_SERVER = 'invalid';
            const { getPolarServer } = await import('../polar');
            expect(() => getPolarServer()).toThrow(
                "POLAR_SERVER must be either 'sandbox' or 'production'",
            );
        });
    });

    describe('getCachedCreditsBalance', () => {
        it('returns null when no cache exists', async () => {
            const { getCachedCreditsBalance } = await import('../polar');
            expect(getCachedCreditsBalance('user-123')).toBeNull();
        });
    });
});
