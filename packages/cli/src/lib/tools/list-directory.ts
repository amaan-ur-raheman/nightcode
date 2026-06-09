import { readdir } from "fs/promises";
import { relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { IGNORE, resolveInsideCwd } from "./utils";

export async function listDirectoryTool(input: unknown) {
    const { path } = toolInputSchemas.listDirectory.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const entries = await readdir(resolved, { withFileTypes: true });

    const results = entries
        .filter((entry) => !entry.name.startsWith(".") && !IGNORE.has(entry.name))
        .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" as const : "file" as const,
        }));

    return {
        path: relative(cwd, resolved) || ".",
        entries: results.sort((a, b) => a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)),
    };
}
