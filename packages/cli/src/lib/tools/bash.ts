import { toolInputSchemas } from '@nightcode/shared';
import { checkCommandSafety } from './dangerous-ops';
import { MAX_OUTPUT, truncate } from './utils';
import { ptySessionManager } from '../pty-session';
import { getProjectCwd } from '../workspace-context';

import { loadSettings } from '../settings';

const MAX_STREAM_BUFFER = 50_000;
const TRIM_STREAM_BUFFER = 30_000;

export function wrapCommandWithDocker(
    command: string,
    cwd: string,
    env: Record<string, string> = {},
): string[] {
    const settings = loadSettings();
    const sandboxImage = settings.sandbox?.image ?? 'node:18-alpine';

    // Construct docker run command
    const args = [
        'run',
        '--rm',
        '-i',
        '-v',
        `${cwd}:/workspace`,
        '-w',
        '/workspace',
    ];

    // Add environment variables
    for (const [key, val] of Object.entries(env)) {
        if (['PATH', 'HOME', 'USER', 'SHELL', 'EDITOR', 'TERM'].includes(key))
            continue;
        args.push('-e', `${key}=${val}`);
    }

    args.push(sandboxImage, 'sh', '-c', command);
    return args;
}

export function spawnCommand(command: string, options: Record<string, any>) {
    const settings = loadSettings();
    if (settings.sandbox?.enabled) {
        const cwd = options.cwd ?? getProjectCwd();
        const env = options.env ?? {};
        const dockerArgs = wrapCommandWithDocker(command, cwd, env);
        return Bun.spawn(['docker', ...dockerArgs], {
            ...options,
            cwd: undefined, // Let the docker CLI command run in process context
        });
    }
    return Bun.spawn(['bash', '-c', command], options);
}

function killProcessGroup(proc: {
    pid?: number | null;
    kill: (signal?: any) => void;
}) {
    try {
        if (proc.pid) {
            // Kill all child processes of this process using pkill -P
            Bun.spawnSync(['pkill', '-9', '-P', String(proc.pid)]);
        }
    } catch {}

    try {
        if (proc.pid) {
            process.kill(-proc.pid, 'SIGKILL');
            return;
        }
    } catch {
        // Fall back to killing the immediate process below.
    }

    try {
        proc.kill('SIGKILL');
    } catch {}
}

/**
 * Read a stream into a buffer, trimming when it exceeds MAX_STREAM_BUFFER.
 * Returns the final buffer contents.
 */
async function readStreamToBuffer(
    stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
    if (!stream) return '';
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value);
            if (buffer.length > MAX_STREAM_BUFFER) {
                buffer = buffer.slice(-TRIM_STREAM_BUFFER);
            }
        }
    } catch {
        // stream closed
    }
    return buffer;
}

export async function bashTool(
    input: unknown,
    _parentMode?: string,
    _parentModel?: string,
    signal?: AbortSignal,
) {
    if (signal?.aborted) {
        return {
            stdout: '',
            stderr: 'Command aborted',
            exitCode: 1,
            timedOut: false,
        };
    }

    const { command, timeout } = toolInputSchemas.bash.parse(input);

    const safety = checkCommandSafety(command);
    if (safety.blocked) {
        return {
            stdout: '',
            stderr: safety.warning ?? 'Command blocked by safety policy',
            exitCode: 1,
            timedOut: false,
            warning: safety.warning,
        };
    }

    let timedOut = false;
    const proc = spawnCommand(command, {
        cwd: getProjectCwd(),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, TERM: 'dumb' },
        detached: true,
    });

    // Tee the streams to prevent locked ReadableStream errors when both
    // readStreamToBuffer and ptySessionManager consume them.
    const [stdout1, stdout2] = proc.stdout
        ? (proc.stdout as any).tee()
        : [null, null];
    const [stderr1, stderr2] = proc.stderr
        ? (proc.stderr as any).tee()
        : [null, null];

    // Collect output directly from process pipes (not the shared PTY singleton)
    // This prevents cross-tool interference when bash calls run in parallel.
    const stdoutPromise = readStreamToBuffer(stdout1);
    const stderrPromise = readStreamToBuffer(stderr1);

    // Register with PTY manager only for interactive attachment purposes.
    // The PTY manager's output buffers are NOT used for result collection.
    const managerProc = {
        stdout: stdout2,
        stderr: stderr2,
        stdin: proc.stdin,
        exited: proc.exited,
        pid: proc.pid,
        kill: (signal?: any) => proc.kill(signal),
    };
    ptySessionManager.registerProcess(managerProc, command);

    // Auto-attach if the command is still running after 1.5 seconds
    const attachTimer = setTimeout(() => {
        if (proc.pid) {
            ptySessionManager.attach();
        }
    }, 1500);

    const timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(proc);
    }, timeout);

    const onAbort = () => {
        killProcessGroup(proc);
    };
    if (signal?.aborted) {
        onAbort();
    } else {
        signal?.addEventListener('abort', onAbort);
    }

    let exitCode = 1;
    try {
        exitCode = await proc.exited;
    } finally {
        clearTimeout(attachTimer);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }

    // Wait for pipe readers to finish after process exits, but don't hang if aborted
    let stdout = '';
    let stderr = '';
    if (!signal?.aborted && !timedOut) {
        let checkAbort: (() => void) | undefined;
        try {
            const [out, err] = await Promise.race([
                Promise.all([stdoutPromise, stderrPromise]),
                new Promise<[string, string]>((_, reject) => {
                    checkAbort = () => reject(new Error('Aborted'));
                    signal?.addEventListener('abort', checkAbort);
                }),
            ]);
            stdout = out;
            stderr = err;
        } catch {
            // aborted during wait
        } finally {
            if (checkAbort) {
                signal?.removeEventListener('abort', checkAbort);
            }
        }
    }

    const result: {
        stdout: string;
        stderr: string;
        exitCode: number;
        timedOut: boolean;
        warning?: string;
    } = {
        stdout: truncate(stdout, MAX_OUTPUT),
        stderr: truncate(stderr, MAX_OUTPUT),
        exitCode,
        timedOut,
    };

    if (safety.warning) {
        result.warning = safety.warning;
    }

    return result;
}
