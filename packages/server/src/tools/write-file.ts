import { z } from "zod";
import { tool } from "ai";
import { mkdir, writeFile } from "fs/promises";
import { resolve, relative, dirname } from "path";

export function createWriteFileTool(cwd: string) {
    return tool({
        description:
            "Create or overwrite a file in the project. Creates parent directories if they don't exist.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to the file to write"),
            content: z.string().describe("The full content to write the file"),
        }),
        execute: async ({ path, content }) => {
            const resolved = resolve(cwd, path);

            if (resolved !== cwd && !resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) {
                return { error: "Path is outside the project directory" };
            }

            try {
                await mkdir(dirname(resolved), { recursive: true });
                await writeFile(resolved, content, "utf-8");

                return {
                    success: true as const,
                    path: relative(cwd, resolved),
                    bytesWritten: Buffer.byteLength(content, "utf-8"),
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to write file: ${message}` };
            }
        }
    })
}
