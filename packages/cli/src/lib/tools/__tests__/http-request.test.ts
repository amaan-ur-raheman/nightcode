import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('httpRequestTool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    describe('SSRF protection', () => {
        it('blocks private addresses', async () => {
            // Use a real private URL - isPrivateHost blocks localhost without any mocking
            const { httpRequestTool } = await import('../http-request');
            const result = await httpRequestTool({
                url: 'http://localhost:3000/secret',
                method: 'GET',
            });
            expect(result).toHaveProperty('error');
            expect((result as { error: string }).error).toContain(
                'internal/private',
            );
        });
    });

    describe('HTTP methods', () => {
        beforeEach(() => {
            vi.resetModules();
        });

        it('makes a GET request and returns response', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Map([['content-type', 'application/json']]),
                text: vi.fn().mockResolvedValue('{"ok":true}'),
            }) as unknown as typeof fetch;

            const { httpRequestTool } = await import('../http-request');
            const result = await httpRequestTool({
                url: 'https://api.example.com/data',
                method: 'GET',
            });
            expect(result).toHaveProperty('status', 200);
            expect(result).toHaveProperty('body');
            expect((result as { body: string }).body).toBe('{"ok":true}');
        });

        it('makes a POST request with body', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 201,
                statusText: 'Created',
                headers: new Map(),
                text: vi.fn().mockResolvedValue('created'),
            }) as unknown as typeof fetch;

            const { httpRequestTool } = await import('../http-request');
            const result = await httpRequestTool({
                url: 'https://api.example.com/items',
                method: 'POST',
                body: '{"name":"test"}',
            });
            expect(result).toHaveProperty('status', 201);
        });

        it('returns headers in response', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Map([['x-request-id', 'abc123']]),
                text: vi.fn().mockResolvedValue('ok'),
            }) as unknown as typeof fetch;

            const { httpRequestTool } = await import('../http-request');
            const result = await httpRequestTool({
                url: 'https://api.example.com/data',
                method: 'GET',
            });
            expect(result).toHaveProperty('headers');
            expect(
                (result as { headers: Record<string, string> }).headers[
                    'x-request-id'
                ],
            ).toBe('abc123');
        });
    });
});
