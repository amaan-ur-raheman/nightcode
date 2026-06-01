import { z } from "zod";
import { tool } from "ai";

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: await proc.exited };
}

export function createGitStatusTool(cwd: string) {
    return tool({
        description: "Show the working tree status (staged, unstaged, and untracked files).",
        inputSchema: z.object({}),
        execute: async () => {
            try {
                const result = await runGit(cwd, ["status", "--short", "--branch"]);
                if (result.exitCode !== 0) return { error: result.stderr || "git status failed" };
                return { status: result.stdout };
            } catch (err) {
                return { error: `git status failed: ${err instanceof Error ? err.message : String(err)}` };
            }
        },
    });
}

export function createGitDiffTool(cwd: string) {
    return tool({
        description: "Show git diff for the working tree or a specific file. Use staged=true to see staged changes.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to a specific file (optional, omit for full diff)").optional(),
            staged: z.boolean().describe("Show staged (cached) diff instead of unstaged").default(false),
        }),
        execute: async ({ path, staged }) => {
            try {
                const args = ["diff"];
                if (staged) args.push("--cached");
                if (path) args.push("--", path);

                const result = await runGit(cwd, args);
                if (result.exitCode !== 0) return { error: result.stderr || "git diff failed" };

                const MAX = 20_000;
                const diff = result.stdout;
                return {
                    diff: diff.length > MAX ? diff.slice(0, MAX) + `\n...(truncated, ${diff.length} total chars)` : diff,
                    truncated: diff.length > MAX,
                };
            } catch (err) {
                return { error: `git diff failed: ${err instanceof Error ? err.message : String(err)}` };
            }
        },
    });
}
