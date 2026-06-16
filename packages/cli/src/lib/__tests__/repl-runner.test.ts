import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to execute this block before any imports are evaluated
vi.hoisted(() => {
    const mockProc = {
        stdin: {
            write: vi.fn(),
            flush: vi.fn(),
        },
        stdout: {
            getReader: () => ({
                read: vi
                    .fn()
                    .mockResolvedValue({ done: true, value: undefined }),
            }),
        },
        stderr: {
            getReader: () => ({
                read: vi
                    .fn()
                    .mockResolvedValue({ done: true, value: undefined }),
            }),
        },
        killed: false,
        exitCode: null as number | null,
        kill: vi.fn(),
    };

    vi.stubGlobal('Bun', {
        spawn: vi.fn().mockReturnValue(mockProc),
    });
});

import { ReplRunner } from '../repl-runner';

describe('ReplRunner', () => {
    let mockProc: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockProc = {
            stdin: {
                write: vi.fn(),
                flush: vi.fn(),
            },
            stdout: {
                getReader: () => ({
                    read: vi
                        .fn()
                        .mockResolvedValue({ done: true, value: undefined }),
                }),
            },
            stderr: {
                getReader: () => ({
                    read: vi
                        .fn()
                        .mockResolvedValue({ done: true, value: undefined }),
                }),
            },
            killed: false,
            exitCode: null as number | null,
            kill: vi.fn(),
        };

        vi.stubGlobal('Bun', {
            spawn: vi.fn().mockReturnValue(mockProc),
        });
    });

    it('initializes the persistent process lazily on command execution', async () => {
        const runner = new ReplRunner();
        expect(Bun.spawn).not.toHaveBeenCalled();
        const execPromise = runner.execute('echo "test"');
        expect(Bun.spawn).toHaveBeenCalled();

        // Simulate data arriving to finish the test gracefully
        // @ts-expect-error - handleData is private and accessed for testing
        runner.handleData('test\n');
        // @ts-expect-error - handleData is private and accessed for testing
        runner.handleData('__REPL_SENTINEL__');
        await execPromise;
    });

    it('executes a command and resolves when sentinel is received', async () => {
        const runner = new ReplRunner();
        const execPromise = runner.execute('echo "test"');

        // Simulate data arriving
        // @ts-expect-error - handleData is private and accessed for testing
        runner.handleData('test\n');
        // @ts-expect-error - handleData is private and accessed for testing
        runner.handleData('__REPL_SENTINEL__');

        const result = await execPromise;
        expect(result).toContain('test');
    });
});
