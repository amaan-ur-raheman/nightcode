interface QueuedCommand {
    command: string;
    resolve: (output: string) => void;
    reject: (err: any) => void;
}

export class ReplRunner {
    private proc: any = null;
    private outputBuffer = '';
    private onDataCallbacks: ((data: string) => void)[] = [];
    private currentResolver: ((output: string) => void) | null = null;
    private sentinel = '__REPL_SENTINEL__';
    private inactivityTimeout: Timer | null = null;
    private readerPromise: Promise<void> | null = null;
    private commandsQueue: QueuedCommand[] = [];
    private isProcessing = false;

    constructor() {
        // Lazily initialized on first execution
    }

    private ensureInitialized() {
        if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
            return;
        }

        const shell =
            process.platform === 'win32'
                ? 'powershell.exe'
                : process.env.SHELL || '/bin/bash';

        // Spawn the persistent shell process.
        this.proc = Bun.spawn([shell], {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                ...process.env,
                TERM: 'dumb', // prevents escape codes
            },
        });

        // Start reading streams in the background
        this.readerPromise = this.readStreams();
    }

    private async readStreams() {
        const decoder = new TextDecoder();

        const readStdout = async () => {
            if (!this.proc?.stdout) return;
            const reader = this.proc.stdout.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    this.handleData(decoder.decode(value));
                }
            } catch (err) {
                console.error('[repl-runner] stdout stream error:', err);
            }
        };

        const readStderr = async () => {
            if (!this.proc?.stderr) return;
            const reader = this.proc.stderr.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    this.handleData(decoder.decode(value));
                }
            } catch (err) {
                console.error('[repl-runner] stderr stream error:', err);
            }
        };

        await Promise.all([readStdout(), readStderr()]);
    }

    private handleData(data: string) {
        this.outputBuffer += data;

        // Notify any active data listeners
        for (const cb of this.onDataCallbacks) {
            cb(data);
        }

        // Sentinel detection
        if (this.currentResolver && this.outputBuffer.includes(this.sentinel)) {
            if (this.inactivityTimeout) {
                clearTimeout(this.inactivityTimeout);
                this.inactivityTimeout = null;
            }

            const parts = this.outputBuffer.split(this.sentinel);
            const output = parts[0] || '';
            this.outputBuffer = parts.slice(1).join(this.sentinel);
            const resolver = this.currentResolver;
            this.currentResolver = null;
            resolver(output);
            return;
        }

        // Inactivity timeout for REPLs
        if (this.currentResolver) {
            if (this.inactivityTimeout) {
                clearTimeout(this.inactivityTimeout);
            }
            this.inactivityTimeout = setTimeout(() => {
                this.inactivityTimeout = null;
                if (this.currentResolver) {
                    const output = this.outputBuffer;
                    this.outputBuffer = '';
                    const resolver = this.currentResolver;
                    this.currentResolver = null;
                    resolver(output);
                }
            }, 500);
        }
    }

    public addDataListener(cb: (data: string) => void) {
        this.onDataCallbacks.push(cb);
    }

    public removeDataListener(cb: (data: string) => void) {
        this.onDataCallbacks = this.onDataCallbacks.filter((c) => c !== cb);
    }

    public async execute(command: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this.commandsQueue.push({ command, resolve, reject });
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    private async processQueue() {
        this.isProcessing = true;
        while (this.commandsQueue.length > 0) {
            const { command, resolve, reject } = this.commandsQueue.shift()!;
            try {
                const output = await this.executeSingle(command);
                resolve(output);
            } catch (err) {
                reject(err);
            }
        }
        this.isProcessing = false;
    }

    private executeSingle(command: string): Promise<string> {
        return new Promise<string>((resolve) => {
            try {
                this.ensureInitialized();
            } catch (err) {
                resolve(
                    `[REPL failed to initialize: ${err instanceof Error ? err.message : String(err)}]`,
                );
                return;
            }

            this.outputBuffer = '';
            this.currentResolver = resolve;

            if (this.inactivityTimeout) {
                clearTimeout(this.inactivityTimeout);
                this.inactivityTimeout = null;
            }

            // Write the command and sentinel to the shell
            if (!this.proc || this.proc.killed || this.proc.exitCode !== null) {
                this.currentResolver = null;
                resolve('[REPL process is not running]');
                return;
            }
            const encoder = new TextEncoder();
            try {
                this.proc.stdin.write(encoder.encode(command + '\n'));
                const escapedSentinel = this.sentinel.replace(/"/g, '\\"');
                this.proc.stdin.write(
                    encoder.encode(`echo "${escapedSentinel}"\n`),
                );
                this.proc.stdin.flush();
            } catch (err) {
                this.currentResolver = null;
                console.error('[repl-runner] Failed to write to stdin:', err);
                resolve(
                    `[REPL stdin error: ${err instanceof Error ? err.message : String(err)}]`,
                );
            }
        });
    }

    public kill() {
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
            this.inactivityTimeout = null;
        }
        try {
            this.proc.kill();
        } catch {}
        this.proc = null;
        // Reject any queued commands
        while (this.commandsQueue.length > 0) {
            const { reject } = this.commandsQueue.shift()!;
            reject(new Error('REPL process was killed'));
        }
        this.currentResolver = null;
        this.isProcessing = false;
    }
}

export const replRunner = new ReplRunner();
