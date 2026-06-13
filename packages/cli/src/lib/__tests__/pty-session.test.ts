import { describe, it, expect, vi } from 'vitest';
import { ptySessionManager } from '../pty-session';

describe('PtySessionManager', () => {
    it('registers process and reads streams', async () => {
        const mockProc = {
            stdout: {
                getReader: () => {
                    let done = false;
                    return {
                        read: async () => {
                            if (done) return { done: true, value: undefined };
                            done = true;
                            return {
                                done: false,
                                value: new TextEncoder().encode(
                                    'stdout-content',
                                ),
                            };
                        },
                    };
                },
            },
            stderr: {
                getReader: () => {
                    let done = false;
                    return {
                        read: async () => {
                            if (done) return { done: true, value: undefined };
                            done = true;
                            return {
                                done: false,
                                value: new TextEncoder().encode(
                                    'stderr-content',
                                ),
                            };
                        },
                    };
                },
            },
            stdin: {
                write: vi.fn(),
                flush: vi.fn(),
            },
            exited: Promise.resolve(0),
        };

        ptySessionManager.registerProcess(mockProc, 'test-cmd');

        // Let stream microtasks run
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(ptySessionManager.getCommand()).toBe('test-cmd');
        expect(ptySessionManager.getStdout()).toContain('stdout-content');
        expect(ptySessionManager.getStderr()).toContain('stderr-content');
        expect(ptySessionManager.getOutput()).toContain('stdout-content');
        expect(ptySessionManager.getOutput()).toContain('stderr-content');
    });

    it('handles keyboard attachment', () => {
        const mockProc = {
            stdout: {
                getReader: () => ({ read: async () => ({ done: true }) }),
            },
            stderr: {
                getReader: () => ({ read: async () => ({ done: true }) }),
            },
            exited: Promise.resolve(0),
        };

        ptySessionManager.registerProcess(mockProc, 'test-cmd');
        expect(ptySessionManager.getIsAttached()).toBe(false);

        ptySessionManager.attach();
        expect(ptySessionManager.getIsAttached()).toBe(true);

        ptySessionManager.detach();
        expect(ptySessionManager.getIsAttached()).toBe(false);
    });
});
