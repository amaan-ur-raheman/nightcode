import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

describe('Server index.ts entrypoint', () => {
    let processOnSpy: any;
    let fsWriteSpy: any;
    let fsUnlinkSpy: any;
    let fsExistsSpy: any;
    let processExitSpy: any;

    beforeEach(() => {
        vi.resetModules();

        processOnSpy = vi.spyOn(process, 'on');
        processExitSpy = vi
            .spyOn(process, 'exit')
            .mockImplementation((() => {}) as any);

        fsWriteSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        fsUnlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
        fsExistsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

        // Mock routes to avoid loading heavy modules/database dependencies
        vi.doMock('../routes/auth', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/chat', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/sessions', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/billing', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/subagent', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/orchestrator', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/export', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/models', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../routes/api-keys', () => ({
            default: new (require('hono').Hono)(),
        }));
        vi.doMock('../middleware/require-auth', () => ({
            requireAuth: (_c: any, next: any) => next(),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers signal handlers and unlinks pid file on exit, SIGTERM, and SIGINT', async () => {
        process.env.PID_FILE = '/tmp/test-nightcode-server.pid';

        await import('../index');

        expect(fsWriteSpy).toHaveBeenCalledWith(
            '/tmp/test-nightcode-server.pid',
            String(process.pid),
        );

        const sigtermCall = processOnSpy.mock.calls.find(
            (call: any) => call[0] === 'SIGTERM',
        );
        const sigintCall = processOnSpy.mock.calls.find(
            (call: any) => call[0] === 'SIGINT',
        );
        const exitCall = processOnSpy.mock.calls.find(
            (call: any) => call[0] === 'exit',
        );

        expect(sigtermCall).toBeDefined();
        expect(sigintCall).toBeDefined();
        expect(exitCall).toBeDefined();

        const sigtermHandler = sigtermCall[1];
        const sigintHandler = sigintCall[1];
        const exitHandler = exitCall[1];

        // Test SIGTERM handler
        fsUnlinkSpy.mockClear();
        processExitSpy.mockClear();
        sigtermHandler();
        expect(fsUnlinkSpy).toHaveBeenCalledWith(
            '/tmp/test-nightcode-server.pid',
        );
        expect(processExitSpy).toHaveBeenCalledWith(0);

        // Test SIGINT handler
        fsUnlinkSpy.mockClear();
        processExitSpy.mockClear();
        sigintHandler();
        expect(fsUnlinkSpy).toHaveBeenCalledWith(
            '/tmp/test-nightcode-server.pid',
        );
        expect(processExitSpy).toHaveBeenCalledWith(0);

        // Test exit handler
        fsUnlinkSpy.mockClear();
        exitHandler();
        expect(fsUnlinkSpy).toHaveBeenCalledWith(
            '/tmp/test-nightcode-server.pid',
        );
    });
});
