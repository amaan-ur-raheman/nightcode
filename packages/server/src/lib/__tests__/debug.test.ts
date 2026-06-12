import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ServerDebugLogger', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('creates a disabled logger by default', async () => {
        process.env.DEBUG = '';
        const { serverDebug } = await import('../debug');
        expect(serverDebug.isEnabled()).toBe(false);
    });

    it('creates an enabled logger when DEBUG=1', async () => {
        process.env.DEBUG = '1';
        const { serverDebug } = await import('../debug');
        expect(serverDebug.isEnabled()).toBe(true);
    });

    it('does not throw when logging while disabled', async () => {
        process.env.DEBUG = '';
        const { serverDebug } = await import('../debug');
        expect(() => {
            serverDebug.log('test', 'message');
            serverDebug.warn('test', 'warning');
            serverDebug.error('test', 'error');
        }).not.toThrow();
    });

    it('formats log messages correctly', async () => {
        process.env.DEBUG = '1';
        const { serverDebug } = await import('../debug');
        const consoleSpy = vi
            .spyOn(console, 'log')
            .mockImplementation(() => {});
        serverDebug.log('http', 'GET /status 200');
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringMatching(/^\[.+\] \[http\] GET \/status 200$/),
        );
        consoleSpy.mockRestore();
    });

    it('warns correctly', async () => {
        process.env.DEBUG = '1';
        const { serverDebug } = await import('../debug');
        const consoleSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        serverDebug.warn('test', 'warning message');
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('WARN: warning message'),
        );
        consoleSpy.mockRestore();
    });

    it('errors correctly', async () => {
        process.env.DEBUG = '1';
        const { serverDebug } = await import('../debug');
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        const err = new Error('test error');
        serverDebug.error('test', 'error message', err);
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('ERROR: error message'),
        );
        consoleSpy.mockRestore();
    });
});
