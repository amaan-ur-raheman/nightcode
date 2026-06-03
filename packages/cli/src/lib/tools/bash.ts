import { toolInputSchemas } from "@nightcode/shared";
import { MAX_OUTPUT, truncate } from "./utils";

export async function bashTool(input: unknown) {
    const { command, timeout } = toolInputSchemas.bash.parse(input);
    let timedOut = false;
    const proc = Bun.spawn(["bash", "-c", command], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, TERM: "dumb" },
        detached: true,
    });
    const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-proc.pid!, 9); } catch { proc.kill(9); }
    }, timeout);
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    return { stdout: truncate(stdout, MAX_OUTPUT), stderr: truncate(stderr, MAX_OUTPUT), exitCode, timedOut };
}
