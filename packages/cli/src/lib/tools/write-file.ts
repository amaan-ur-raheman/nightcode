import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { resolveInsideCwd } from "./utils";
import { generateDiff, formatDiff } from "../diff-utils";
import { undoManager } from "../undo-manager";
import { globCache } from "../glob-cache";

export async function writeFileTool(input: unknown) {
    const { path, content } = toolInputSchemas.writeFile.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);

    let existingContent = "";
    try {
        existingContent = await readFile(resolved, "utf-8");
    } catch {
        // New file
    }

    const diff = generateDiff(existingContent, content);
    const hasChanges = diff.some((d) => d.type !== "context");
    if (!hasChanges) {
        return { success: true as const, path: relative(cwd, resolved), bytesWritten: 0, diff: "(no changes)" };
    }

    const diffOutput = formatDiff(diff);
    await undoManager.backup(resolved, "writeFile", `Write ${path}`);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    globCache.invalidate();
    return { success: true as const, path: relative(cwd, resolved), bytesWritten: Buffer.byteLength(content, "utf-8"), diff: diffOutput };
}
