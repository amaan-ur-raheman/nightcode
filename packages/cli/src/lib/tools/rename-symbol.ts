import { readFile, writeFile } from "fs/promises";
import { relative, resolve } from "path";
import { toolInputSchemas } from "@nightcode/shared";

export async function renameSymbolTool(input: unknown) {
    const { oldName, newName, glob: globPattern } = toolInputSchemas.renameSymbol.parse(input);
    const cwd = process.cwd();
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "g");
    const g = new Bun.Glob(globPattern);
    const changed: { path: string; replacements: number }[] = [];

    for await (const file of g.scan({ cwd, absolute: false, onlyFiles: true })) {
        const resolved = resolve(cwd, file);
        if (!resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) continue;
        const content = await readFile(resolved, "utf-8");
        let count = 0;
        const updated = content.replace(regex, () => { count++; return newName; });
        if (count > 0) {
            await writeFile(resolved, updated, "utf-8");
            changed.push({ path: relative(cwd, resolved), replacements: count });
        }
    }

    return { filesChanged: changed.length, changes: changed };
}
