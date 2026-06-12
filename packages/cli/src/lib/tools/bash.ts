import { toolInputSchemas } from '@nightcode/shared';
import { checkCommandSafety } from './bash-safety';
import { MAX_OUTPUT, truncate } from './utils';

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
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, TERM: 'dumb' },
        detached: true,
    });
    const timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(proc);
    }, timeout);

    const onAbort = () => {
        killProcessGroup(proc);
    };
    signal?.addEventListener('abort', onAbort);

    let stdout = '';
    let stderr = '';
    let exitCode = 1;
    try {
        [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        exitCode = await proc.exited;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
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
