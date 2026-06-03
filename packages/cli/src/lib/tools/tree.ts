import { lstat, readdir } from "fs/promises";
import { join, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { IGNORE, MAX_TREE_LINES, resolveInsideCwd } from "./utils";

async function buildTree(dir: string, prefix: string, depth: number, maxDepth: number): Promise<string[]> {
    if (depth > maxDepth) return [];
    const entries = (await readdir(dir)).filter((e) => !e.startsWith(".") && !IGNORE.has(e)).sort();
    const lines: string[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const isLast = i === entries.length - 1;
        const fullPath = join(dir, entry);
        try {
            const info = await lstat(fullPath);
            const isDir = info.isDirectory() && !info.isSymbolicLink();
            lines.push(prefix + (isLast ? "└── " : "├── ") + entry + (isDir ? "/" : ""));
            if (isDir) lines.push(...await buildTree(fullPath, prefix + (isLast ? "    " : "│   "), depth + 1, maxDepth));
        } catch { /* skip */ }
    }
    return lines;
}

export async function treeTool(input: unknown) {
    const { path, depth } = toolInputSchemas.tree.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const root = relative(cwd, resolved) || ".";
    const lines = [root + "/", ...await buildTree(resolved, "", 0, depth)];
    const truncated = lines.length > MAX_TREE_LINES;
    return {
        tree: (truncated ? lines.slice(0, MAX_TREE_LINES) : lines).join("\n"),
        ...(truncated ? { truncated: true, totalLines: lines.length } : {}),
    };
}
