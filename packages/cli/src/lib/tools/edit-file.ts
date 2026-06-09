import { readFile, writeFile } from "fs/promises";
import { relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { resolveInsideCwd } from "./utils";

export async function editFileTool(input: unknown) {
    const { path, oldString, newString } = toolInputSchemas.editFile.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const content = await readFile(resolved, "utf-8");
    let occurrences = 0;
    let idx = 0;
    while ((idx = content.indexOf(oldString, idx)) !== -1) {
        occurrences++;
        idx += oldString.length;
    }

    if (occurrences === 0) throw new Error("oldString not found in file");
    if (occurrences > 1) throw new Error(`oldString is ambiguous; found ${occurrences} matches`);

    await writeFile(resolved, content.replace(oldString, () => newString), "utf-8");
    return { success: true as const, path: relative(cwd, resolved) };
}
