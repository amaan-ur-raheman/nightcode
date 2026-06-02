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
            const MAX_OUTPUT = 20_000;

            const spawnAndCapture = async (argv: string[]) => {
                let timedOut = false;
                const proc = Bun.spawn(argv, {
                    cwd,
                    stdout: "pipe",
                    stderr: "pipe",
                    detached: true,
                });
                const timer = setTimeout(() => {
                    timedOut = true;
                    try { process.kill(-proc.pid!, 9); } catch { proc.kill(9); }
                }, 60_000);
                const [stdout, stderr] = await Promise.all([
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text(),
                ]);
                const exitCode = await proc.exited;
                clearTimeout(timer);
                const truncate = (s: string) => s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n...(truncated)" : s;
                return { stdout: truncate(stdout.trim()), stderr: truncate(stderr.trim()), exitCode, timedOut };
            };

            const runShell = (cmd: string) => spawnAndCapture(["bash", "-c", cmd]);
            const runDirect = (argv: string[]) => spawnAndCapture(argv);

            const results: Record<string, unknown> = {};

            if (type === "tsc" || type === "both") {
                let discoveredTsconfig: string | null = null;
                if (existsSync(join(cwd, "tsconfig.json"))) {
                    discoveredTsconfig = "tsconfig.json";
                } else {
                    try {
                        discoveredTsconfig = readdirSync(cwd).find((f) => /^tsconfig\..+\.json$/.test(f)) ?? null;
                    } catch {
                        discoveredTsconfig = null;
                    }
                }
                if (!discoveredTsconfig) {
                    results.tsc = { stdout: "", stderr: "No tsconfig.json found in project root", exitCode: 1 };
                } else {
                    results.tsc = await runDirect(["bunx", "tsc", "-p", discoveredTsconfig, "--noEmit"]);
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
                    results.lint = await runShell("bunx eslint . --max-warnings=0");
                }
            }

            const hasErrors = Object.values(results).some(
                (r) => (r as { exitCode: number }).exitCode !== 0
            );

            return { hasErrors, ...results };
        },
    });
}
