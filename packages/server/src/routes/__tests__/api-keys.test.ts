import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock the keychain module completely (no importOriginal)
vi.mock('@nightcode/shared', () => ({
    keychain: {
        isAvailable: vi.fn(),
    },
}));

import apiKeys from '../api-keys';

describe('API Keys Route', () => {
    let app: Hono;

    beforeEach(() => {
        vi.clearAllMocks();
        app = new Hono().route('/api-keys', apiKeys);
    });

    describe('GET /api-keys/status', () => {
        it('returns available: true when keychain is available', async () => {
            const { keychain } = await import('@nightcode/shared');
            vi.mocked(keychain.isAvailable).mockReturnValue(true);

            const res = await app.request('/api-keys/status');
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toEqual({ available: true });
        });

        it('returns available: false when keychain is not available', async () => {
            const { keychain } = await import('@nightcode/shared');
            vi.mocked(keychain.isAvailable).mockReturnValue(false);

            const res = await app.request('/api-keys/status');
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toEqual({ available: false });
        });

        it('returns 500 when keychain throws', async () => {
            const { keychain } = await import('@nightcode/shared');
            vi.mocked(keychain.isAvailable).mockImplementation(() => {
                throw new Error('keychain error');
            });

            const res = await app.request('/api-keys/status');
            const body = await res.json();

            expect(res.status).toBe(500);
            expect(body).toHaveProperty('error');
        });
    });
});
