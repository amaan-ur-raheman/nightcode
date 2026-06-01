import { z } from "zod";
import { tool } from "ai";
import { readFile } from "fs/promises";
import { resolve, relative } from "path";

const MAX_FILE_SIZE = 10_000;

export function createReadFileTool(cwd: string) {
    return tool({
        description:
            "Read the contents of a file in the project. Returns the file text, truncated if very large. Use offset and limit to page through large files.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to the file to read"),
            offset: z
                .number()
                .describe("Line number to start reading from (1-indexed, optional)")
                .optional(),
            limit: z
                .number()
                .describe("Number of lines to return (optional)")
                .optional(),
        }),
        execute: async ({ path, offset, limit }) => {
            const resolved = resolve(cwd, path);
            const rel = relative(cwd, resolved);

            if (rel.startsWith("..") || (resolved !== cwd && !resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/"))) {
                return { error: "Path is outside the project directory" };
            }

            try {
                const content = await readFile(resolved, "utf-8");
                const totalLines = content.split("\n").length;
                const totalBytes = Buffer.byteLength(content, "utf-8");

                if (offset != null && limit != null) {
                    const start = Math.max(1, offset);
                    const end = Math.min(totalLines, start + limit - 1);
                    const lines = content.split("\n").slice(start - 1, end);

                    return {
                        content: lines.join("\n"),
                        path: relative(cwd, resolved),
                        offset: start,
                        limit,
                        totalLines,
                        totalBytes,
                        displayedLines: lines.length,
                    };
                }

                if (content.length > MAX_FILE_SIZE) {
                    return {
                        content: content.slice(0, MAX_FILE_SIZE),
                        truncated: true,
                        totalLength: content.length,
                        totalLines,
                        totalBytes,
                    };
                }

                return {
                    content,
                    path: relative(cwd, resolved),
                    totalLines,
                    totalBytes,
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to read file: ${message}` };
            }
        }
    })
}
