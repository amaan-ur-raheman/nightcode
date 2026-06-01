import type { Mode } from "@nightcode/database/enums";

import { createGrepTool } from "./grep";
import { createGlobTool } from "./glob";
import { createBashTool } from "./bash";
import { createReadFileTool } from "./read-file";
import { createEditFileTool } from "./edit-file";
import { createWriteFileTool } from "./write-file";
import { createListDirectoryTool } from "./list-directory";
import { createSearchReplaceTool } from "./search-replace";
import { createDeleteFileTool } from "./delete-file";
import { createMoveFileTool } from "./move-file";
import { createGetDiagnosticsTool } from "./get-diagnostics";
import { createTreeTool } from "./tree";
import { createGitStatusTool, createGitDiffTool } from "./git";
import { createCreateDirectoryTool } from "./create-directory";
import { createRunTestsTool } from "./run-tests";
import { createWebFetchTool } from "./web-fetch";
import { createFileInfoTool } from "./file-info";
import { createPatchTool } from "./patch";

export function createTools(cwd: string, mode: Mode) {
    const readOnlyTools = {
        readFile: createReadFileTool(cwd),
        listDirectory: createListDirectoryTool(cwd),
        grep: createGrepTool(cwd),
        glob: createGlobTool(cwd),
        tree: createTreeTool(cwd),
        fileInfo: createFileInfoTool(cwd),
        getDiagnostics: createGetDiagnosticsTool(cwd),
        gitStatus: createGitStatusTool(cwd),
        gitDiff: createGitDiffTool(cwd),
        webFetch: createWebFetchTool(),
    };

    if (mode === "PLAN") {
        return readOnlyTools;
    }

    return {
        ...readOnlyTools,
        editFile: createEditFileTool(cwd),
        writeFile: createWriteFileTool(cwd),
        bash: createBashTool(cwd),
        patch: createPatchTool(cwd),
        searchReplace: createSearchReplaceTool(cwd),
        deleteFile: createDeleteFileTool(cwd),
        moveFile: createMoveFileTool(cwd),
        createDirectory: createCreateDirectoryTool(cwd),
        runTests: createRunTestsTool(cwd),
    };
}
