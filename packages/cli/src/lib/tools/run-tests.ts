import { toolInputSchemas } from "@nightcode/shared";
import { MAX_TEST_OUTPUT } from "./utils";

export async function runTestsTool(input: unknown, _parentMode?: string, _parentModel?: string, signal?: AbortSignal) {
    const { filter, timeout } = toolInputSchemas.runTests.parse(input);
    const args = ["test"];
    if (filter) args.push(filter);

    const proc = Bun.spawn(["bun", ...args], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", TERM: "dumb" },
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeout);

    const onAbort = () => proc.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort);

    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);

    const output = (stdout + stderr).slice(0, MAX_TEST_OUTPUT);
    const clean = output.replace(/\u001b\[[0-9;]*m/g, "");
    const passMatch = clean.match(/(\d+)\s+pass/);
    const failMatch = clean.match(/(\d+)\s+fail/);
    return {
        exitCode,
        passed: passMatch ? Number(passMatch[1]) : null,
        failed: failMatch ? Number(failMatch[1]) : null,
        output,
    };
}
