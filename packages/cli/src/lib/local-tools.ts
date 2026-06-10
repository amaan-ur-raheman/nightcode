import { Mode, type ModeType } from "@nightcode/shared";
import { batchManager } from "./batch-manager";
import { toolAnalytics } from "./tool-analytics";

const PLAN_TOOLS = new Set([
    "readFile", "listDirectory", "glob", "grep",
    "tree", "fileInfo", "gitStatus", "gitDiff", "webFetch",
    "codeSearch", "getOutline", "diffFiles",
    "spawnAgent", "spawnResearcher",
    "gitLog", "gitBlame", "gitStatusExtended",
    "tokenCount",
    "memorySet", "memoryGet", "memoryDelete", "memoryList", "memorySearch",
    "keychainSet", "keychainGet", "keychainDelete",
]);

async function directExecute(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
): Promise<unknown> {
    const startTime = Date.now();
    let success = true;

    try {
        const { loadTool } = await import("./tools/index");
        const tool = await loadTool(toolName);
        const result = await tool(input, mode, parentModel, signal);
        return result;
    } catch (error) {
        success = false;
        throw error;
    } finally {
        const duration = Date.now() - startTime;
        toolAnalytics.recordToolCall(toolName, duration, success).catch(() => {});
    }
}

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

    return batchManager.addRequest(
        toolName,
        input,
        directExecute,
        mode,
        parentModel,
        signal,
    );
}
