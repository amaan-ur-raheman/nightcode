import { Mode, type ModeType } from "@nightcode/shared";
import { batchManager } from "./batch-manager";
import { toolAnalytics } from "./tool-analytics";
import { runWithToolExecutionPolicy } from "./tool-execution-policy";

const PLAN_TOOLS = new Set([
    "readFile", "listDirectory", "glob", "grep",
    "tree", "fileInfo", "gitStatus", "gitDiff", "webFetch",
    "codeSearch", "getOutline", "diffFiles",
    "spawnAgent", "spawnResearcher",
    "gitLog", "gitBlame", "gitStatusExtended",
    "tokenCount",
    "memorySet", "memoryGet", "memoryDelete", "memoryList", "memorySearch",
    "keychainSet", "keychainGet", "keychainDelete",
    "getTaskStatus", "cancelTask",
    "orchestrator", // Tool checks BUILD mode internally and throws with a descriptive error
]);

async function directExecute(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
): Promise<unknown> {
    const startTime = Date.now();
    let success = true;

    try {
        const { loadTool } = await import("./tools/index");
        const tool = await loadTool(toolName);
        const result = await runWithToolExecutionPolicy(
            toolName,
            input,
            signal,
            (toolSignal) => tool(input, mode, parentModel, toolSignal, execId),
        );
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
    execId?: string,
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
        execId,
    );
}
