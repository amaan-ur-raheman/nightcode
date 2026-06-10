import { relative, resolve } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { globCache } from "../glob-cache";
import { IGNORE, MAX_RESULTS, resolveInsideCwd } from "./utils";

export async function globTool(input: unknown) {
    const { pattern, path } = toolInputSchemas.glob.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);

    const allMatches = await globCache.getCachedGlob(pattern, resolved);
    const files: string[] = [];
    let truncated = false;

    for (const match of allMatches) {
        if (match.split("/").some((seg) => IGNORE.has(seg))) continue;
        if (files.length >= MAX_RESULTS) { truncated = true; break; }
        files.push(relative(cwd, resolve(resolved, match)));
    }

    files.sort();
    return { files, ...(truncated ? { truncated: true } : {}) };
}
