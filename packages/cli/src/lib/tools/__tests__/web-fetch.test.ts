import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('webFetchTool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    describe('SSRF protection', () => {
        it('blocks private addresses', async () => {
            const { webFetchTool } = await import('../web-fetch');
            const result = await webFetchTool({
                url: 'http://localhost:3000/secret',
            });
            expect(result).toHaveProperty('error');
            expect((result as { error: string }).error).toContain(
                'internal/private',
            );
        });
    });

    describe('HTTP responses', () => {
        beforeEach(() => {
            vi.resetModules();
        });

        it('returns status and body for non-2xx response', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                headers: new Map(),
                text: () => Promise.resolve('Not Found'),
            }) as unknown as typeof fetch;
            const { webFetchTool } = await import('../web-fetch');
            const result = await webFetchTool({
                url: 'https://example.com/missing',
            });
            expect(result).toHaveProperty('status', 404);
            expect(result).toHaveProperty('body', 'Not Found');
        });

        it('returns body on successful fetch', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Map([['content-type', 'text/plain']]),
                text: () => Promise.resolve('Hello, world!'),
            }) as unknown as typeof fetch;
            const { webFetchTool } = await import('../web-fetch');
            const result = await webFetchTool({
                url: 'https://example.com/hello',
            });
            expect(result).toHaveProperty('status', 200);
            expect(result).toHaveProperty('body', 'Hello, world!');
        });

        it('supports POST method with body', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Map(),
                text: () => Promise.resolve('created'),
            }) as unknown as typeof fetch;
            const { webFetchTool } = await import('../web-fetch');
            const result = await webFetchTool({
                url: 'https://example.com/api',
                method: 'POST',
                body: '{"name":"test"}',
            });
            expect(result).toHaveProperty('status', 200);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://example.com/api',
                expect.objectContaining({
                    method: 'POST',
                    body: '{"name":"test"}',
                }),
            );
        });
    });
});
