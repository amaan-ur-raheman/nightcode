import { z } from "zod";
import { tool } from "ai";
import { mkdir } from "fs/promises";
import { resolve, relative } from "path";

export function createCreateDirectoryTool(cwd: string) {
    return tool({
        description: "Create a directory (and any missing parent directories) in the project.",
        inputSchema: z.object({
            path: z.string().describe("Relative path of the directory to create"),
        }),
        execute: async ({ path }) => {
            const resolved = resolve(cwd, path);

            if (resolved !== cwd && !resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) {
                            return { error: "Path is outside the project directory" };
                        }

            try {
                await mkdir(resolved, { recursive: true });
                return { success: true as const, path: relative(cwd, resolved) };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to create directory: ${message}` };
            }
        },
    });
}
