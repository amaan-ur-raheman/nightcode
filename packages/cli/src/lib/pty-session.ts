import { EventEmitter } from 'events';

import { useState, useEffect, useCallback } from 'react';

const MAX_BUFFER_SIZE = 50000;
const TRIM_BUFFER_SIZE = 30000;

export class PtySessionManager extends EventEmitter {
    private activeProc: any = null;
    private command: string = '';
    private combinedBuffer: string = '';
    private stdoutBuffer: string = '';
    private stderrBuffer: string = '';
    private isAttached: boolean = false;
    private onDataCallbacks: Set<(data: string) => void> = new Set();
    private onStateChangeCallbacks: Set<() => void> = new Set();
    private streamPromises: Promise<void>[] = [];

    constructor() {
        super();
    }

    public registerProcess(proc: any, command: string) {
        this.activeProc = proc;
        this.command = command;
        this.combinedBuffer = '';
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.isAttached = false;
        this.notifyStateChange();

        const decoderStdout = new TextDecoder();
        const decoderStderr = new TextDecoder();

        const readStdout = async () => {
            if (!proc.stdout) return;
            const reader = proc.stdout.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoderStdout.decode(value);
                    this.stdoutBuffer += chunk;
                    if (this.stdoutBuffer.length > MAX_BUFFER_SIZE) {
                        this.stdoutBuffer =
                            this.stdoutBuffer.slice(-TRIM_BUFFER_SIZE);
                    }
                    this.appendOutput(chunk);
                }
            } catch {
                // stream closed
            }
        };

        const readStderr = async () => {
            if (!proc.stderr) return;
            const reader = proc.stderr.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoderStderr.decode(value);
                    this.stderrBuffer += chunk;
                    if (this.stderrBuffer.length > MAX_BUFFER_SIZE) {
                        this.stderrBuffer =
                            this.stderrBuffer.slice(-TRIM_BUFFER_SIZE);
                    }
                    this.appendOutput(chunk);
                }
            } catch {
                // stream closed
            }
        };

        this.streamPromises = [readStdout(), readStderr()];

        proc.exited.then((exitCode: number) => {
            if (this.activeProc === proc) {
                this.appendOutput(`\n[Process exited with code ${exitCode}]\n`);
                this.activeProc = null;
                this.isAttached = false;
                this.notifyStateChange();
                this.emit('exit', exitCode);
            }
        });
    }

    public async waitForStreams() {
        await Promise.all(this.streamPromises);
    }

    public getActiveProcess() {
        return this.activeProc;
    }

    public getCommand() {
        return this.command;
    }

    public getOutput() {
        return this.combinedBuffer;
    }

    public getStdout() {
        return this.stdoutBuffer;
    }

    public getStderr() {
        return this.stderrBuffer;
    }

    public attach() {
        if (!this.activeProc) return;
        this.isAttached = true;
        this.notifyStateChange();
    }

    public detach() {
        this.isAttached = false;
        this.notifyStateChange();
    }

    public getIsAttached() {
        return this.isAttached;
    }

    public writeInput(data: string) {
        if (!this.activeProc || !this.activeProc.stdin) return;
        try {
            const encoder = new TextEncoder();
            this.activeProc.stdin.write(encoder.encode(data));
            this.activeProc.stdin.flush();

            // Local echo: since spawned process pipes do not automatically echo typed keystrokes back to stdout,
            // we append printable input to the combined buffer so the user can see what they type.
            if (data === '\r' || data === '\n') {
                this.appendOutput('\n');
            } else if (data === '\x7f' || data === '\x08') {
                if (this.combinedBuffer.length > 0) {
                    this.combinedBuffer = this.combinedBuffer.slice(0, -1);
                    this.notifyStateChange();
                }
            } else if (
                data.length === 1 &&
                data.charCodeAt(0) >= 32 &&
                data.charCodeAt(0) <= 126
            ) {
                this.appendOutput(data);
            }
        } catch {
            // failed to write
        }
    }

    public interrupt() {
        if (!this.activeProc) return;
        try {
            if (this.activeProc.pid) {
                process.kill(-this.activeProc.pid, 'SIGINT');
            } else {
                this.activeProc.kill('SIGINT');
            }
        } catch {
            // failed to kill
        }
    }

    private appendOutput(chunk: string) {
        this.combinedBuffer += chunk;
        // Keep buffer size reasonable
        if (this.combinedBuffer.length > MAX_BUFFER_SIZE) {
            this.combinedBuffer = this.combinedBuffer.slice(-TRIM_BUFFER_SIZE);
        }
        for (const cb of this.onDataCallbacks) {
            cb(chunk);
        }
        this.notifyStateChange();
    }

    public subscribeData(cb: (data: string) => void) {
        this.onDataCallbacks.add(cb);
        return () => {
            this.onDataCallbacks.delete(cb);
        };
    }

    public subscribeState(cb: () => void) {
        this.onStateChangeCallbacks.add(cb);
        return () => {
            this.onStateChangeCallbacks.delete(cb);
        };
    }

    private notifyStateChange() {
        for (const cb of this.onStateChangeCallbacks) {
            cb();
        }
    }
}

export const ptySessionManager = new PtySessionManager();

export function usePtySession() {
    const [state, setState] = useState({
        active: !!ptySessionManager.getActiveProcess(),
        command: ptySessionManager.getCommand(),
        output: ptySessionManager.getOutput(),
        isAttached: ptySessionManager.getIsAttached(),
    });

    useEffect(() => {
        const unsubscribe = ptySessionManager.subscribeState(() => {
            setState({
                active: !!ptySessionManager.getActiveProcess(),
                command: ptySessionManager.getCommand(),
                output: ptySessionManager.getOutput(),
                isAttached: ptySessionManager.getIsAttached(),
            });
        });
        return unsubscribe;
    }, []);

    const attach = useCallback(() => {
        ptySessionManager.attach();
    }, []);

    const detach = useCallback(() => {
        ptySessionManager.detach();
    }, []);

    const writeInput = useCallback((data: string) => {
        ptySessionManager.writeInput(data);
    }, []);

    const interrupt = useCallback(() => {
        ptySessionManager.interrupt();
    }, []);

    return {
        ...state,
        attach,
        detach,
        writeInput,
        interrupt,
    };
}
