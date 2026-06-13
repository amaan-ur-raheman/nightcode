/**
 * Shared command runner for CLI tools.
 * Extracted from auto-fix-pipeline.ts and performance-profiler.ts to avoid duplication.
 */

export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
}

export async function runCommand(
    cmd: string,
    args: string[],
    cwd: string,
    timeoutMs: number = 60_000,
): Promise<CommandResult> {
    const startTime = Date.now();

    return new Promise((resolveResult) => {
        const proc = Bun.spawn([cmd, ...args], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
        });

        const timer = setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            } catch {
                /* best effort */
            }
        }, timeoutMs);

        Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ])
            .then(async ([stdout, stderr]) => {
                const exitCode = await proc.exited;
                clearTimeout(timer);
                resolveResult({
                    exitCode,
                    stdout,
                    stderr,
                    durationMs: Date.now() - startTime,
                });
            })
            .catch((err) => {
                clearTimeout(timer);
                resolveResult({
                    exitCode: 1,
                    stdout: '',
                    stderr: String(err),
                    durationMs: Date.now() - startTime,
                });
            });
    });
}
