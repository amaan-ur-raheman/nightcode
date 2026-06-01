import type { Mode } from "@nightcode/database/enums";

import { createGrepTool } from "./grep";
import { createGlobTool } from "./glob";
import { createBashTool } from "./bash";
import { createReadFileTool } from "./read-file";
import { createEditFileTool } from "./edit-file";
import { createWriteFileTool } from "./write-file";
import { createListDirectoryTool } from "./list-directory";

export function createTools(cwd: string, mode: Mode) {
    const readOnlyTools = {
        readFile: createReadFileTool(cwd),
        listDirectory: createListDirectoryTool(cwd),
        grep: createGrepTool(cwd),
        glob: createGlobTool(cwd),
    };

    if (mode === "PLAN") {
        return readOnlyTools;
    }

    return {
        ...readOnlyTools,
        editFile: createEditFileTool(cwd),
        writeFile: createWriteFileTool(cwd),
        bash: createBashTool(cwd),
    };
}
