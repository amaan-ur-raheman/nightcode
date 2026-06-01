import { z } from "zod";
import { tool } from "ai";
import { readFile, writeFile } from "fs/promises";
import { resolve, relative, join } from "path";

export function createSearchReplaceTool(cwd: string) {
    return tool({
        description:
            "Find and replace text across multiple files using a regex pattern. Returns a summary of all changes made.",
        inputSchema: z.object({
            pattern: z.string().describe("Regex pattern to search for"),
            replacement: z.string().describe("Replacement string (supports capture groups like $1)"),
            glob: z.string().describe("Glob pattern to match files (e.g. 'src/**/*.ts')"),
            flags: z.string().describe("Regex flags (default: 'g')").default("g"),
        }),
        execute: async ({ pattern, replacement, glob: globPattern, flags }) => {
            try {
                const g = new Bun.Glob(globPattern);
                const normalizedFlags = [...new Set(flags.includes("g") ? flags : flags + "g")].join("");
                const regex = new RegExp(pattern, normalizedFlags);
                const changed: { path: string; replacements: number }[] = [];

                for await (const file of g.scan({ cwd, absolute: false, onlyFiles: true })) {
                    const abs = join(cwd, file);
                    const resolved = resolve(abs);

                    if (resolved !== cwd && !resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) {
                        return {
                            error: `Path is outside the project directory: ${file}`,
                        };
                    }
                    const content = await readFile(resolved, "utf-8");
                    let count = 0;
                    const updated = content.replace(regex, (...args) => {
                        count++;
                        return replacement.replace(/\$(\d+)/g, (_, i) => args[Number(i)] ?? "");
                    });
                    if (count > 0) {
                        await writeFile(resolved, updated, "utf-8");
                        changed.push({ path: relative(cwd, resolved), replacements: count });
                    }
                }

                return { filesChanged: changed.length, changes: changed };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Search-replace failed: ${message}` };
            }
        },
    });
}
