import { z } from "zod";
import { tool } from "ai";
import { stat } from "fs/promises";
import { resolve, relative } from "path";

export function createFileInfoTool(cwd: string) {
    return tool({
        description:
            "Get metadata about a file or directory: size, line count, whether it is a directory, and last modified time. Use this before reading a large file to decide if it is worth reading.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to the file or directory"),
        }),
        execute: async ({ path }) => {
            const resolved = resolve(cwd, path);

            if (resolved !== cwd && !resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) {
                            return { error: "Path is outside the project directory" };
                        }

            try {
                const info = await stat(resolved);

                if (!info.isFile() && !info.isDirectory()) {
                    return { error: "Path is neither a file nor a directory" };
                }

                const result: Record<string, unknown> = {
                    path: relative(cwd, resolved) || ".",
                    name: relative(cwd, resolved) || ".",
                    isDirectory: info.isDirectory(),
                    size: info.size,
                    modified: info.mtime.toISOString(),
                };

                if (info.isFile()) {
                    let newlineCount = 0;
                    let seenAnyByte = false;
                    let lastByteWasNewline = false;
                    for await (const chunk of Bun.file(resolved).stream()) {
                        for (let i = 0; i < chunk.length; i++) {
                            seenAnyByte = true;
                            lastByteWasNewline = chunk[i] === 0x0A;
                            if (lastByteWasNewline) newlineCount++;
                        }
                    }
                    result.lineCount = newlineCount + (seenAnyByte && !lastByteWasNewline ? 1 : 0);
                }

                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to stat file: ${message}` };
            }
        },
    });
}
