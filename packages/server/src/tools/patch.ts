import { z } from "zod";
import { resolve } from "path";
import { tool } from "ai";

const MAX_PATCH_SIZE = 200_000;

export function createPatchTool(cwd: string) {
    return tool({
        description:
            "Apply a unified diff patch to the project. The patch should be a standard unified diff (the output of `git diff`). Use this for multi-file changes that are easier to express as a patch than as individual edits.",
        inputSchema: z.object({
            patch: z.string().describe("The unified diff patch to apply"),
        }),
        execute: async ({ patch }) => {
            if (patch.length > MAX_PATCH_SIZE) {
                return { error: `Patch exceeds maximum size of ${MAX_PATCH_SIZE} characters` };
            }

            // Reject patches that reference paths outside cwd
            const targetPaths = [...patch.matchAll(/^\+\+\+\s+b\/(.+)$/gm)];
            for (const match of targetPaths) {
                const targetPath = match[1]!;
                if (targetPath.includes("..")) {
                    return { error: `Patch escapes project directory: ${targetPath}` };
                }
                const resolvedTarget = resolve(cwd, targetPath);
                if (!resolvedTarget.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) {
                    return { error: `Patch escapes project directory: ${targetPath}` };
                }
            }

            try {
                const result = Bun.spawn(["git", "apply", "--reject", "--whitespace=fix"], {
                    stdin: "pipe",
                    stdout: "pipe",
                    stderr: "pipe",
                    cwd,
                });

                result.stdin.write(patch);
                await result.stdin.end();

                const [stdout, stderr] = await Promise.all([
                    new Response(result.stdout).text(),
                    new Response(result.stderr).text(),
                ]);

                await result.exited;

                if (result.exitCode === 0) {
                    return {
                        success: true as const,
                        message: "Patch applied cleanly",
                    };
                }

                if (result.exitCode === 1) {
                    const rejected = stderr.includes(".rej");
                    return {
                        success: false,
                        message: rejected
                            ? "Patch partially applied; some hunks were rejected (.rej files created)"
                            : "Patch failed to apply",
                        stderr: stderr.slice(0, 5000),
                    };
                }

                return {
                    error: `git apply failed: ${stderr.trim()}`,
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to apply patch: ${message}` };
            }
        },
    });
}
