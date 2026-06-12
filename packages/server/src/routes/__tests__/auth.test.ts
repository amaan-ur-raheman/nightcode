import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import auth from '../auth';

describe('Auth Route', () => {
    const app = new Hono().route('/auth', auth);

    describe('GET /auth/callback', () => {
        it('redirects to localhost port with code and state', async () => {
            const port = 4200;
            const encoded = Buffer.from(JSON.stringify({ port })).toString(
                'base64url',
            );
            const state = `${encoded}.sig`;
            const code = 'test-auth-code';

            const res = await app.request(
                `/auth/callback?code=${code}&state=${encodeURIComponent(state)}`,
            );

            expect(res.status).toBe(302);
            const location = res.headers.get('location');
            expect(location).toContain(`localhost:${port}/callback`);
            expect(location).toContain(`code=${code}`);
        });

        it('returns 400 when code is missing', async () => {
            const encoded = Buffer.from(
                JSON.stringify({ port: 4200 }),
            ).toString('base64url');
            const state = `${encoded}.sig`;

            const res = await app.request(
                `/auth/callback?state=${encodeURIComponent(state)}`,
            );

            expect(res.status).toBe(400);
            const body = await res.text();
            expect(body).toContain('Missing authorization code');
        });

        it('returns 400 when state is missing', async () => {
            const res = await app.request('/auth/callback?code=test-code');

            expect(res.status).toBe(400);
            const body = await res.text();
            expect(body).toContain('Missing authorization code');
        });

        it('returns 400 when error is present', async () => {
            const res = await app.request(
                '/auth/callback?error=access_denied&error_description=User+denied+access',
            );

            expect(res.status).toBe(400);
            const body = await res.text();
            expect(body).toContain('User denied access');
        });

        it('returns 400 when error is present without description', async () => {
            const res = await app.request('/auth/callback?error=access_denied');

            expect(res.status).toBe(400);
            const body = await res.text();
            expect(body).toContain('access_denied');
        });

        it('returns 400 for invalid state format', async () => {
            const res = await app.request(
                '/auth/callback?code=test&state=invalid',
            );

            expect(res.status).toBe(400);
            const body = await res.text();
            expect(body).toContain('Invalid authentication state');
        });

        it('returns 400 for state with invalid port', async () => {
            const encoded = Buffer.from(
                JSON.stringify({ port: 'not-a-number' }),
            ).toString('base64url');
            const state = `${encoded}.sig`;

            const res = await app.request(
                `/auth/callback?code=test&state=${encodeURIComponent(state)}`,
            );

            expect(res.status).toBe(400);
            const body = await res.text();
            expect(body).toContain('Invalid authentication state');
        });
    });
});
