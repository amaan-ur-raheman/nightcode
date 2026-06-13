import { toolInputSchemas } from '@nightcode/shared';
import { checkCommandSafety } from './dangerous-ops';
import { MAX_OUTPUT, truncate } from './utils';
import { ptySessionManager } from '../pty-session';

export function spawnCommand(command: string, options: Record<string, any>) {
    return Bun.spawn(['bash', '-c', command], options);
}

function killProcessGroup(proc: {
    pid?: number | null;
    kill: (signal?: any) => void;
}) {
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

export async function bashTool(
    input: unknown,
    _parentMode?: string,
    _parentModel?: string,
    signal?: AbortSignal,
) {
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
        cwd: process.cwd(),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, TERM: 'dumb' },
        detached: true,
    });

    ptySessionManager.registerProcess(proc, command);

    // Auto-attach if the command is still running after 1.5 seconds (potentially waiting for input or doing long operations)
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
    signal?.addEventListener('abort', onAbort);

    let exitCode = 1;
    try {
        exitCode = await proc.exited;
    } finally {
        clearTimeout(attachTimer);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }

    await ptySessionManager.waitForStreams();
    const stdout = ptySessionManager.getStdout();
    const stderr = ptySessionManager.getStderr();

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
