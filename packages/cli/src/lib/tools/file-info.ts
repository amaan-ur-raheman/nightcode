import { stat } from "fs/promises";
import { basename, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { resolveInsideCwd } from "./utils";

export async function fileInfoTool(input: unknown) {
    const { path } = toolInputSchemas.fileInfo.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const info = await stat(resolved);

    if (!info.isFile() && !info.isDirectory()) return { error: "Path is neither a file nor a directory" };

    const result: Record<string, unknown> = {
        path: relative(cwd, resolved) || ".",
        name: basename(resolved) || ".",
        isDirectory: info.isDirectory(),
        size: info.size,
        modified: info.mtime.toISOString(),
    };

    if (info.isFile()) {
        let newlineCount = 0;
        if (info.size <= 1024 * 1024) {
            // Small file: read entire content at once and count
            const content = await Bun.file(resolved).text();
            for (let i = 0; i < content.length; i++) {
                if (content.charCodeAt(i) === 0x0a) newlineCount++;
            }
        } else {
            // Large file: stream in larger chunks
            let seenAnyByte = false, lastByteWasNewline = false;
            for await (const chunk of Bun.file(resolved).stream()) {
                for (let i = 0; i < chunk.length; i++) {
                    seenAnyByte = true;
                    lastByteWasNewline = chunk[i] === 0x0a;
                    if (lastByteWasNewline) newlineCount++;
                }
                if (chunk.length > 0) lastByteWasNewline = chunk[chunk.length - 1] === 0x0a;
            }
            result.lineCount = newlineCount + (seenAnyByte && !lastByteWasNewline ? 1 : 0);
            return result;
        }
        result.lineCount = newlineCount + (info.size > 0 && newlineCount === 0 ? 1 : 0);
    }

    return result;
}
