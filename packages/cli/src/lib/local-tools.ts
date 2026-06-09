import { Mode, type ModeType } from "@nightcode/shared";

const PLAN_TOOLS = new Set([
    "readFile", "listDirectory", "glob", "grep",
    "tree", "fileInfo", "gitStatus", "gitDiff", "webFetch",
    "codeSearch", "getOutline", "diffFiles", "spawnAgent",
    "spawnResearcher",
]);

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

    const { loadTool } = await import("./tools/index");
    const tool = await loadTool(toolName);
    return tool(input, mode, parentModel, signal);
}
