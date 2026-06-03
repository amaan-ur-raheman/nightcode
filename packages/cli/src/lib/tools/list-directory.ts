import { readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { IGNORE, resolveInsideCwd } from "./utils";

export async function listDirectoryTool(input: unknown) {
    const { path } = toolInputSchemas.listDirectory.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const entries = await readdir(resolved);
    const results: { name: string; type: "file" | "directory" }[] = [];

    for (const entry of entries) {
        if (entry.startsWith(".") || IGNORE.has(entry)) continue;
        try {
            const info = await stat(join(resolved, entry));
            results.push({ name: entry, type: info.isDirectory() ? "directory" : "file" });
        } catch { /* skip */ }
    }

    results.sort((a, b) =>
        a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name),
    );
    return { path: relative(cwd, resolved) || ".", entries: results };
}
