import { relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { MAX_FILE_SIZE, readCachedFile, resolveInsideCwd } from "./utils";

export async function readFileTool(input: unknown) {
    const { path, offset, limit } = toolInputSchemas.readFile.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const content = await readCachedFile(resolved);
    const allLines = content.split("\n");
    const totalLines = allLines.length;
    const totalBytes = Buffer.byteLength(content, "utf-8");

    if (offset != null || limit != null) {
        const start = Math.max(1, offset ?? 1);
        const effectiveLimit = limit != null ? Math.max(0, limit) : Math.max(1, totalLines - start + 1);
        const end = Math.min(totalLines, start + effectiveLimit - 1);
        const slicedLines = allLines.slice(start - 1, end);
        const sliced = slicedLines.join("\n");
        if (sliced.length > MAX_FILE_SIZE) {
            return { content: sliced.slice(0, MAX_FILE_SIZE), path: relative(cwd, resolved), offset: start, limit: effectiveLimit, totalLines, totalBytes, displayedLines: slicedLines.length, truncated: true, totalLength: sliced.length };
        }
        return { content: sliced, path: relative(cwd, resolved), offset: start, limit: effectiveLimit, totalLines, totalBytes, displayedLines: slicedLines.length };
    }

    if (content.length > MAX_FILE_SIZE) {
        return { content: content.slice(0, MAX_FILE_SIZE), path: relative(cwd, resolved), truncated: true, totalLength: content.length, totalLines, totalBytes };
    }

    return { content, path: relative(cwd, resolved), totalLines, totalBytes };
}
