import { mkdir, rename } from "fs/promises";
import { dirname, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { resolveInsideCwd } from "./utils";
import { globCache } from "../glob-cache";

export async function moveFileTool(input: unknown) {
    const { from, to } = toolInputSchemas.moveFile.parse(input);
    const { cwd, resolved: src } = resolveInsideCwd(from);
    const { resolved: dest } = resolveInsideCwd(to);

    await mkdir(dirname(dest), { recursive: true });
    await rename(src, dest);
    globCache.invalidate();
    return { success: true as const, from: relative(cwd, src), to: relative(cwd, dest) };
}
