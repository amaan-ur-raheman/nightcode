import { Mode, type ModeType } from "@nightcode/shared";
import {
    bashTool, codeSearchTool, createDirectoryTool, createFileTool,
    deleteFileTool, diffFilesTool, editFileTool, fileInfoTool,
    getOutlineTool, gitDiffTool, gitStatusTool, globTool, grepTool,
    httpRequestTool, listDirectoryTool, moveFileTool, patchTool,
    readFileTool, renameSymbolTool, runTestsTool, searchReplaceTool,
    treeTool, webFetchTool, writeFileTool, spawnAgentTool,
    spawnCodeReviewerTool, spawnTestWriterTool, spawnDebuggerTool, spawnRefactorTool, spawnResearcherTool,
} from "./tools";

const PLAN_TOOLS = new Set([
    "readFile", "listDirectory", "glob", "grep",
    "tree", "fileInfo", "gitStatus", "gitDiff", "webFetch",
    "codeSearch", "getOutline", "diffFiles", "spawnAgent",
    "spawnResearcher",
]);

type ToolFn =
    | ((input: unknown) => Promise<unknown>)
    | ((input: unknown, parentMode?: ModeType, parentModel?: string, signal?: AbortSignal) => Promise<unknown>);

const TOOL_MAP: Record<string, ToolFn> = {
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
    spawnAgent: spawnAgentTool,
    spawnCodeReviewer: spawnCodeReviewerTool,
    spawnTestWriter: spawnTestWriterTool,
    spawnDebugger: spawnDebuggerTool,
    spawnRefactor: spawnRefactorTool,
    spawnResearcher: spawnResearcherTool,
};

export async function executeLocalTool(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
) {
    if (mode === Mode.PLAN && !PLAN_TOOLS.has(toolName)) {
        throw new Error(`Tool ${toolName} is not available in PLAN mode`);
    }

    const tool = TOOL_MAP[toolName] as (input: unknown, parentMode?: ModeType, parentModel?: string, signal?: AbortSignal) => Promise<unknown>;
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    return tool(input, mode, parentModel, signal);
}
