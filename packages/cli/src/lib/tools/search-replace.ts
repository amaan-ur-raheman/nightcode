import { readFile, writeFile } from "fs/promises";
import { relative, resolve } from "path";
import { toolInputSchemas } from "@nightcode/shared";

export async function searchReplaceTool(input: unknown) {
    const { pattern, replacement, glob: globPattern, flags } = toolInputSchemas.searchReplace.parse(input);
    const cwd = process.cwd();
    const g = new Bun.Glob(globPattern);
    const normalizedFlags = [...new Set(flags.includes("g") ? flags : flags + "g")].join("");
    const regex = new RegExp(pattern, normalizedFlags);
    const changed: { path: string; replacements: number }[] = [];

    for await (const file of g.scan({ cwd, absolute: false, onlyFiles: true })) {
        const resolved = resolve(cwd, file);
        if (!resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) continue;
        const content = await readFile(resolved, "utf-8");
        const count = (content.match(regex) || []).length;
        const updated = content.replace(regex, replacement);
        if (count > 0) {
            await writeFile(resolved, updated, "utf-8");
            changed.push({ path: relative(cwd, resolved), replacements: count });
        }
    }

    return { filesChanged: changed.length, changes: changed };
}
