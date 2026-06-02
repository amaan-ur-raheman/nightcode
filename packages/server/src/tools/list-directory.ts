import { z } from "zod";
import { tool } from "ai";
import { readdir, stat } from "fs/promises";
import { resolve, relative, join } from "path";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage"]);

export function createListDirectoryTool(cwd: string) {
    return tool({
        description:
            "List files and directories in a project directory. Returns names with type indicators.",
        inputSchema: z.object({
            path: z
                .string()
                .describe("Relative path to the directory to list (defaults to project root)")
                .default(".")
        }),
        execute: async ({ path }) => {
            const resolved = resolve(cwd, path);
            if (resolved !== cwd && !resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) {
                return { error: "Path is outside the project directory" };
            }

            try {
                const entries = await readdir(resolved);
                const results: { name: string, type: "file" | "directory" }[] = [];

                for (const entry of entries) {
                    if (entry.startsWith(".") || IGNORE.has(entry)) continue;

                    try {
                        const entryPath = join(resolved, entry);
                        const info = await stat(entryPath);

                        results.push({
                            name: entry,
                            type: info.isDirectory() ? "directory" : "file"
                        });
                    } catch {
                        // skip entries we can't stat
                    }
                }

                results.sort((a, b) => {
                    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });

                return {
                    path: relative(cwd, resolved) || ".",
                    entries: results
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to list directory: ${message}` };
            }
        }
    });
}
