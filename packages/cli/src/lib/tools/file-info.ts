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
        let newlineCount = 0, seenAnyByte = false, lastByteWasNewline = false;
        for await (const chunk of Bun.file(resolved).stream()) {
            for (let i = 0; i < chunk.length; i++) {
                seenAnyByte = true;
                lastByteWasNewline = chunk[i] === 0x0a;
                if (lastByteWasNewline) newlineCount++;
            }
        }
        result.lineCount = newlineCount + (seenAnyByte && !lastByteWasNewline ? 1 : 0);
    }

    return result;
}
