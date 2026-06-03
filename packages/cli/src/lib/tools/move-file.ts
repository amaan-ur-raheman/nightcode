import { mkdir, rename } from "fs/promises";
import { dirname, relative, resolve } from "path";
import { toolInputSchemas } from "@nightcode/shared";

export async function moveFileTool(input: unknown) {
    const { from, to } = toolInputSchemas.moveFile.parse(input);
    const cwd = process.cwd();
    const src = resolve(cwd, from);
    const dest = resolve(cwd, to);
    const safeCwd = cwd.endsWith("/") ? cwd : cwd + "/";

    if (!src.startsWith(safeCwd) || !dest.startsWith(safeCwd)) {
        return { error: "Path is outside the project directory" };
    }

    await mkdir(dirname(dest), { recursive: true });
    await rename(src, dest);
    return { success: true as const, from: relative(cwd, src), to: relative(cwd, dest) };
}
