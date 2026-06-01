import { z } from "zod";
import { tool } from "ai";

export function createGetDiagnosticsTool(cwd: string) {
    return tool({
        description:
            "Run TypeScript type-checking (tsc --noEmit) and/or ESLint on the project and return structured diagnostics. Use after making changes to verify correctness.",
        inputSchema: z.object({
            type: z.enum(["tsc", "lint", "both"]).describe("Which diagnostics to run").default("both"),
        }),
        execute: async ({ type }) => {
            const run = async (cmd: string) => {
                const proc = Bun.spawn(["bash", "-c", cmd], {
                    cwd,
                    stdout: "pipe",
                    stderr: "pipe",
                });
                const timer = setTimeout(() => proc.kill("SIGKILL"), 60_000);
                const [stdout, stderr] = await Promise.all([
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text(),
                ]);
                const exitCode = await proc.exited;
                clearTimeout(timer);
                return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
            };

            const results: Record<string, unknown> = {};

            if (type === "tsc" || type === "both") {
                const tsconfigCheck = await run("ls tsconfig.json tsconfig.*.json 2>/dev/null | head -1");
                if (!tsconfigCheck.stdout) {
                    results.tsc = { stdout: "", stderr: "No tsconfig.json found in project root", exitCode: 1 };
                } else {
                    results.tsc = await run("bunx tsc --noEmit");
                }
            }

            if (type === "lint" || type === "both") {
                const eslintCheck = await run("ls eslint.config.* .eslintrc.* .eslintrc 2>/dev/null | head -1");
                if (!eslintCheck.stdout) {
                    results.lint = { stdout: "", stderr: "No ESLint config found in project root", exitCode: 1 };
                } else {
                    results.lint = await run("bunx eslint . --max-warnings=0");
                }
            }

            const hasErrors = Object.values(results).some(
                (r) => (r as { exitCode: number }).exitCode !== 0
            );

            return { hasErrors, ...results };
        },
    });
}
