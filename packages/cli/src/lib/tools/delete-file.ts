import { rm } from "fs/promises";
import { relative, resolve } from "path";
import { toolInputSchemas } from "@nightcode/shared";

export async function deleteFileTool(input: unknown) {
    const { path, recursive } = toolInputSchemas.deleteFile.parse(input);
    const cwd = process.cwd();
    const resolved = resolve(cwd, path);

    if (resolved === cwd) return { error: "Cannot delete the project root directory" };
    if (!resolved.startsWith(cwd.endsWith("/") ? cwd : cwd + "/")) return { error: "Path is outside the project directory" };

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
