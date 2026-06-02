import { z } from "zod";
import { tool } from "ai";
import { readdir, lstat } from "fs/promises";
import { resolve, relative, join } from "path";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage"]);
const MAX_LINES = 500;

async function buildTree(dir: string, prefix: string, depth: number, maxDepth: number): Promise<string[]> {
    if (depth > maxDepth) return [];
    const entries = (await readdir(dir)).filter((e) => !e.startsWith(".") && !IGNORE.has(e)).sort();
    const lines: string[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        const fullPath = join(dir, entry);

        try {
            const info = await lstat(fullPath);
            const isDir = info.isDirectory() && !info.isSymbolicLink();
            lines.push(prefix + connector + entry + (isDir ? "/" : ""));
            if (isDir) {
                lines.push(...await buildTree(fullPath, childPrefix, depth + 1, maxDepth));
            }
        } catch {
            // skip
        }
    }

    return lines;
}

export function createTreeTool(cwd: string) {
    return tool({
        description:
            "Display the directory tree of the project. More useful than list-directory for getting a full structural overview.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to start from").default("."),
            depth: z.number().describe("Maximum depth to traverse (default: 3)").default(3),
        }),
        execute: async ({ path, depth }) => {
            const resolved = resolve(cwd, path);

            if (resolved !== cwd && !resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) {
                return { error: "Path is outside the project directory" };
            }

            try {
                const root = relative(cwd, resolved) || ".";
                const lines = [root + "/", ...await buildTree(resolved, "", 0, depth)];
                const truncated = lines.length > MAX_LINES;
                return {
                    tree: (truncated ? lines.slice(0, MAX_LINES) : lines).join("\n"),
                    ...(truncated ? { truncated: true, totalLines: lines.length } : {}),
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to build tree: ${message}` };
            }
        },
    });
}
