import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import billing from '../billing';
import type { AuthenticatedEnv } from '../../middleware/require-auth';

vi.mock('../../lib/polar', () => ({
    createCheckoutUrl: vi
        .fn()
        .mockResolvedValue('https://checkout.polar.sh/test'),
    createCustomerPortalUrl: vi
        .fn()
        .mockResolvedValue('https://portal.polar.sh/test'),
    getAvailableCreditsBalance: vi.fn().mockResolvedValue(50),
}));

// Helper: create a billing app with auth middleware that injects userId
function createBillingApp() {
    const app = new Hono<AuthenticatedEnv>();
    app.use('*', async (c, next) => {
        c.set('userId', 'test-user-id');
        await next();
    });
    app.route('/billing', billing);
    return app;
}

describe('Billing Route', () => {
    let app: Hono<AuthenticatedEnv>;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createBillingApp();
    });

    describe('POST /billing/checkout', () => {
        it('returns checkout URL', async () => {
            const res = await app.request('/billing/checkout', {
                method: 'POST',
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toHaveProperty('url');
            expect(body.url).toContain('checkout.polar.sh');
        });

        it('propagates polar errors', async () => {
            const { createCheckoutUrl } = await import('../../lib/polar');
            vi.mocked(createCheckoutUrl).mockRejectedValueOnce(
                new Error('Polar API error'),
            );

            const res = await app.request('/billing/checkout', {
                method: 'POST',
            });
            expect(res.status).toBe(500);
        });
    });

    describe('POST /billing/portal', () => {
        it('returns portal URL', async () => {
            const res = await app.request('/billing/portal', {
                method: 'POST',
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toHaveProperty('url');
            expect(body.url).toContain('portal.polar.sh');
        });

        it('propagates polar errors', async () => {
            const { createCustomerPortalUrl } = await import('../../lib/polar');
            vi.mocked(createCustomerPortalUrl).mockRejectedValueOnce(
                new Error('Polar API error'),
            );

            const res = await app.request('/billing/portal', {
                method: 'POST',
            });
            expect(res.status).toBe(500);
        });
    });

    describe('GET /billing/credits', () => {
        it('returns credits balance', async () => {
            const res = await app.request('/billing/credits');
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toHaveProperty('balance', 50);
        });

        it('returns balance: null on error', async () => {
            const { getAvailableCreditsBalance } =
                await import('../../lib/polar');
            vi.mocked(getAvailableCreditsBalance).mockRejectedValueOnce(
                new Error('API error'),
            );

            const res = await app.request('/billing/credits');
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toEqual({ balance: null });
        });
    });

    describe('GET /billing/success', () => {
        it('returns success text', async () => {
            const res = await app.request('/billing/success');
            const body = await res.text();

            expect(res.status).toBe(200);
            expect(body).toContain('Done');
        });
    });
});
