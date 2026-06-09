import { rm } from "fs/promises";
import { relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { resolveInsideCwd } from "./utils";

export async function deleteFileTool(input: unknown) {
    const { path, recursive } = toolInputSchemas.deleteFile.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);

    if (resolved === cwd) return { error: "Cannot delete the project root directory" };

    try {
        await rm(resolved, { recursive });
        return { success: true as const, path: relative(cwd, resolved) };
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOTEMPTY") return { error: "Directory is not empty. Set recursive=true to force delete." };
        if (code === "ENOENT") return { error: "Path not found." };
        throw err;
    }
}
