import { z } from "zod";
import { tool } from "ai";
import { rm } from "fs/promises";
import { resolve, relative } from "path";

export function createDeleteFileTool(cwd: string) {
    return tool({
        description: "Delete a file or empty directory from the project.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to the file or directory to delete"),
            recursive: z.boolean().describe("Delete directories recursively").default(false),
        }),
        execute: async ({ path, recursive }) => {
            const resolved = resolve(cwd, path);

            if (resolved === cwd) {
                return { error: "Cannot delete the project root directory" };
            }

            const safeCwd = cwd.endsWith("/") ? cwd : cwd + "/";
            if (!resolved.startsWith(safeCwd)) {
                return { error: "Path is outside the project directory" };
            }

            try {
                await rm(resolved, { recursive });
                return { success: true as const, path: relative(cwd, resolved) };
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === "ENOTEMPTY") {
                    return { error: "Directory is not empty. Set recursive=true to force delete." };
                }
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to delete: ${message}` };
            }
        },
    });
}
