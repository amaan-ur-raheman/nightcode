import { relative, resolve } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { IGNORE, MAX_RESULTS, resolveInsideCwd } from "./utils";

export async function globTool(input: unknown) {
    const { pattern, path } = toolInputSchemas.glob.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const glob = new Bun.Glob(pattern);
    const files: string[] = [];
    let truncated = false;

    for await (const match of glob.scan({ cwd: resolved, dot: false, onlyFiles: true })) {
        if (match.split("/").some((seg) => IGNORE.has(seg))) continue;
        if (files.length >= MAX_RESULTS) { truncated = true; break; }
        files.push(relative(cwd, resolve(resolved, match)));
    }

    files.sort();
    return { files, ...(truncated ? { truncated: true } : {}) };
}
