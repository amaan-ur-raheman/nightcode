import { Mode, type ModeType } from "@nightcode/shared";
import {
    bashTool, codeSearchTool, createDirectoryTool, createFileTool,
    deleteFileTool, diffFilesTool, editFileTool, fileInfoTool,
    getOutlineTool, gitDiffTool, gitStatusTool, globTool, grepTool,
    httpRequestTool, listDirectoryTool, moveFileTool, patchTool,
    readFileTool, renameSymbolTool, runTestsTool, searchReplaceTool,
    treeTool, webFetchTool, writeFileTool,
} from "./tools";

const PLAN_TOOLS = new Set([
    "readFile", "listDirectory", "glob", "grep",
    "tree", "fileInfo", "gitStatus", "gitDiff", "webFetch",
    "codeSearch", "getOutline", "diffFiles",
]);

const TOOL_MAP: Record<string, (input: unknown) => Promise<unknown>> = {
    readFile: readFileTool,
    listDirectory: listDirectoryTool,
    glob: globTool,
    grep: grepTool,
    tree: treeTool,
    fileInfo: fileInfoTool,
    gitStatus: () => gitStatusTool(),
    gitDiff: gitDiffTool,
    webFetch: webFetchTool,
    codeSearch: codeSearchTool,
    getOutline: getOutlineTool,
    diffFiles: diffFilesTool,
    writeFile: writeFileTool,
    editFile: editFileTool,
    bash: bashTool,
    patch: patchTool,
    searchReplace: searchReplaceTool,
    deleteFile: deleteFileTool,
    moveFile: moveFileTool,
    createDirectory: createDirectoryTool,
    runTests: runTestsTool,
    httpRequest: httpRequestTool,
    createFile: createFileTool,
    renameSymbol: renameSymbolTool,
};

export async function executeLocalTool(toolName: string, input: unknown, mode: ModeType) {
    if (mode === Mode.PLAN && !PLAN_TOOLS.has(toolName)) {
        throw new Error(`Tool ${toolName} is not available in PLAN mode`);
    }

    const tool = TOOL_MAP[toolName];
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    return tool(input);
}
