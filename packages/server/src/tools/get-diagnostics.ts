import { z } from "zod";
import { tool } from "ai";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

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
                const hasTsconfig = existsSync(join(cwd, "tsconfig.json")) ||
                    readdirSync(cwd).some((f) => /^tsconfig\..+\.json$/.test(f));
                if (!hasTsconfig) {
                    results.tsc = { stdout: "", stderr: "No tsconfig.json found in project root", exitCode: 1 };
                } else {
                    results.tsc = await run("bunx tsc --noEmit");
                }
            }

            if (type === "lint" || type === "both") {
                const hasEslint = [
                    "eslint.config.js",
                    "eslint.config.mjs",
                    "eslint.config.cjs",
                    "eslint.config.ts",
                    ".eslintrc.js",
                    ".eslintrc.mjs",
                    ".eslintrc.cjs",
                    ".eslintrc.json",
                    ".eslintrc.yml",
                    ".eslintrc.yaml",
                    ".eslintrc",
                ].some((f) => existsSync(join(cwd, f)));
                if (!hasEslint) {
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
