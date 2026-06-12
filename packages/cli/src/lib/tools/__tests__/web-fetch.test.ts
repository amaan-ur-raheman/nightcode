import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('webFetchTool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    describe('SSRF protection', () => {
        it('blocks private addresses', async () => {
            // Use a real private URL - isPrivateHost blocks localhost without any mocking
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

        it('returns HTTP error for non-2xx response', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                headers: new Map(),
                body: null,
            }) as unknown as typeof fetch;
            const { webFetchTool } = await import('../web-fetch');
            const result = await webFetchTool({
                url: 'https://example.com/missing',
            });
            expect(result).toHaveProperty('error');
            expect((result as { error: string }).error).toContain('404');
        });

        it('returns body on successful fetch', async () => {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('Hello, world!'));
                    controller.close();
                },
            });
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Map([['content-type', 'text/plain']]),
                body: stream,
            }) as unknown as typeof fetch;
            const { webFetchTool } = await import('../web-fetch');
            const result = await webFetchTool({
                url: 'https://example.com/hello',
            });
            expect(result).toHaveProperty('status', 200);
            expect(result).toHaveProperty('body');
        });
    });
});
