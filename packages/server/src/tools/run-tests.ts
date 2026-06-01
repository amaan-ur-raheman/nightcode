import { z } from "zod";
import { tool } from "ai";

const MAX_OUTPUT = 30_000;

export function createRunTestsTool(cwd: string) {
    return tool({
        description:
            "Run the project's test suite and return structured results including pass/fail counts and any error output.",
        inputSchema: z.object({
            filter: z.string().describe("Optional test name filter / file pattern").optional(),
            timeout: z.number().describe("Timeout in milliseconds (default: 60000)").default(60_000),
        }),
        execute: async ({ filter, timeout }) => {
            const args = ["test"];
            if (filter) args.push(filter);

            try {
                const proc = Bun.spawn(["bun", ...args], {
                    cwd,
                    stdout: "pipe",
                    stderr: "pipe",
                    env: { ...process.env, FORCE_COLOR: "0", TERM: "dumb" },
                });

                const timer = setTimeout(() => proc.kill("SIGKILL"), timeout);

                const [stdout, stderr] = await Promise.all([
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text(),
                ]);

                const exitCode = await proc.exited;
                clearTimeout(timer);

                const combined = stdout + stderr;
                const output = combined.slice(0, MAX_OUTPUT);

                // Strip ANSI escape codes before parsing the summary line
                const clean = output.replace(/\u001b\[[0-9;]*m/g, "");

                const passMatch = clean.match(/(\d+)\s+pass/);
                const failMatch = clean.match(/(\d+)\s+fail/);

                return {
                    exitCode,
                    passed: passMatch ? Number(passMatch[1]) : null,
                    failed: failMatch ? Number(failMatch[1]) : null,
                    output,
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to run tests: ${message}` };
            }
        },
    });
}
