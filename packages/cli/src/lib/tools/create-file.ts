import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { resolveInsideCwd } from "./utils";
import { globCache } from "../glob-cache";

export async function createFileTool(input: unknown) {
    const { path, content } = toolInputSchemas.createFile.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);

    try {
        await readFile(resolved);
        return { error: `File already exists: ${path}` };
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, { encoding: "utf-8", flag: "wx" } as Parameters<typeof writeFile>[2]);
    globCache.invalidate();
    return { success: true as const, path: relative(cwd, resolved), bytesWritten: Buffer.byteLength(content, "utf-8") };
}
