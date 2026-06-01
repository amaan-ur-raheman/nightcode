import { z } from "zod";
import { tool } from "ai";
import { rename, mkdir } from "fs/promises";
import { resolve, relative, dirname } from "path";

export function createMoveFileTool(cwd: string) {
    return tool({
        description: "Move or rename a file or directory within the project.",
        inputSchema: z.object({
            from: z.string().describe("Relative path of the source file or directory"),
            to: z.string().describe("Relative path of the destination"),
        }),
        execute: async ({ from, to }) => {
            const src = resolve(cwd, from);
            const dest = resolve(cwd, to);

            const safeCwd = cwd.endsWith("/") ? cwd : cwd + "/";
            if (!src.startsWith(safeCwd) || !dest.startsWith(safeCwd)) {
                return { error: "Path is outside the project directory" };
            }

            try {
                await mkdir(dirname(dest), { recursive: true });
                await rename(src, dest);
                return {
                    success: true as const,
                    from: relative(cwd, src),
                    to: relative(cwd, dest),
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to move: ${message}` };
            }
        },
    });
}
