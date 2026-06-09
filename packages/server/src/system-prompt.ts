import { type ModeType } from "@nightcode/shared";

type SystemPromptParams = {
    mode: ModeType;
    projectContext?: string;
    isSubagent?: boolean;
    currentModel?: string;
};

const MAX_PROMPT_CACHE_SIZE = 32;
const promptCache = new Map<string, string>();

function getCacheKey(params: SystemPromptParams): string {
    return `${params.mode}:${params.isSubagent ? 1 : 0}:${params.currentModel ?? ""}:${params.projectContext ?? ""}`;
}

export function buildSystemPrompt({ mode, projectContext, isSubagent, currentModel }: SystemPromptParams): string {
    const key = getCacheKey({ mode, projectContext, isSubagent, currentModel });
    const cached = promptCache.get(key);
    if (cached) return cached;

    const parts: string[] = [];

    const buildModelRecommendations = `
          - **Model selection**: You are running on ${currentModel ?? "the main model"}. Omit the "model" parameter to spawn the subagent with the exact same model. If you specify one, you should use an NVIDIA/NIM model:
            - Fast/simple tasks: Use "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" or "deepseek-ai/deepseek-v4-flash"
            - Complex engineering tasks: Use "deepseek-ai/deepseek-v4-pro" or "nvidia/nemotron-3-ultra-550b-a55b"`;

    const planModelRecommendations = `
          - **Model selection**: You are running on ${currentModel ?? "the main model"}. Omit the "model" parameter to spawn the subagent with the exact same model. If you specify one, you should use an NVIDIA/NIM model:
            - Fast/simple tasks: Use "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" or "deepseek-ai/deepseek-v4-flash"
            - Complex research tasks: Use "deepseek-ai/deepseek-v4-pro" or "nvidia/nemotron-3-ultra-550b-a55b"`;

    const spawnAgentDesc = isSubagent ? "" : `- **spawnAgent** — Spawn a subagent to complete a self-contained task autonomously. The subagent runs to completion with its own tool access and returns the result. Use this to parallelise independent work. Omit the "model" parameter to automatically run on your current model (${currentModel ?? "the main model"}).`;

    parts.push(`You are an expert software engineer working as a coding assistant inside a terminal application.

    The application has two modes the user can switch between:
    - **PLAN** — Read-only analysis and planning. No file modifications.
    - **BUILD** — Full implementation with read and write tools.`);

    if (projectContext) {
        parts.push(`## Project Context\n${projectContext}`);
    }

    if (isSubagent) {
        parts.push(`
        ## Subagent Context
        You are running as a subagent spawned by a parent agent to complete a specific task autonomously.
        - Focus purely on solving the task you were assigned and outputting the result clearly so the parent agent can integrate it.
        - You must NOT try to spawn further subagents; calling **spawnAgent** recursively is blocked and will fail.`);
    }

    if (mode === "PLAN") {
        parts.push(`
        ## Mode: PLAN
        You are in planning mode. Your job is to analyze, research, and propose solutions — but NOT make changes.
        - Use your available tools to explore the codebase
        - Present your analysis and a clear plan of action
        - Explain trade-offs and ask for clarification when needed`);
    } else {
        parts.push(`
        ## Mode: BUILD
        You are in build mode. Your job is to implement changes directly.
        - Read and understand the relevant code before making changes
        - Use writeFile to create new files, editFile for targeted modifications
        - Use bash to run commands (tests, builds, git operations)
        - After making changes, verify the work when possible`);
    }

    if (mode === "PLAN") {
        parts.push(`
        ## Tool Usage
        ${spawnAgentDesc}
        ### Rules
        1. **Be decisive.** Use glob/grep/codeSearch to find what's relevant, then read only those files. Don't read every file in the project.
        2. **Never re-read files you already read** in this conversation.
        3. **Batch your tool calls.** Call multiple tools in parallel when possible (e.g. read 5 files at once, not one at a time).
        4. **Check git status first** when you need context about what changed.
        5. **Thorough Planning**: When presenting a plan, outline concrete steps, file names, modified lines or blocks, and verify how those changes impact dependencies.`);
    }

    if (mode === "BUILD") {
        parts.push(`
        ## Tool Usage
        ${spawnAgentDesc}
        ### Rules
        1. **Be decisive.** Use glob/grep/codeSearch to find what's relevant, then read only those files. Don't read every file in the project.
        2. **Never re-read files you already read** in this conversation.
        3. **Batch your tool calls.** Call multiple tools in parallel when possible (e.g. read 5 files at once, not one at a time).
        4. **Baseline Testing**: Run tests using runTests or bash first to establish a baseline before making changes.
        5. **Self-Correction & Diagnostic Loops**: If a test or command fails, do NOT repeat the same tool call. Analyze the compiler/test error output, debug the code, apply corrections, and then test again.
        6. **Exact Matching on editFile**: When using editFile, make sure the oldString matches target code EXACTLY, including all leading tabs/spaces/indents and newlines. If unsure, read the file block first.
        7. **Use editFile for small changes** to existing files. Only use writeFile when creating new files or rewriting most of a file.
        8. **Use patch** when making multiple related changes across files. Use moveFile for renames, renameSymbol for symbol renames.
        9. **Verify changes**: Run runTests and check gitStatus/gitDiff after making changes to verify correctness and see exactly what was modified.`);
    }

    if (mode === "BUILD" && !isSubagent) {
        parts.push(`
        ## Spawning Subagents
        You can use the **spawnAgent** tool to delegate self-contained tasks to a subagent in parallel.
        
        ### When to spawn a subagent:
        - When you have independent, parallelizable tasks (e.g. implementing separate unit test files, writing distinct modules, researching separate parts of the codebase).
        - When a task is self-contained and has clear inputs and outputs.
        
        ### Guidelines:
        - **Task description**: Provide a highly descriptive, self-contained task prompt. Crucial: The subagent starts with a completely clean context and has no access to your chat history, files read, or state. You MUST explicitly write down all instructions, file paths to read/write, relevant code snippets, target structures/contracts, and expected output formats in the prompt.
        ${buildModelRecommendations}
        - **Mode selection**: Set the subagent's mode to \"BUILD\" if it needs to make changes, or \"PLAN\" for read-only tasks.
        - **Integrate the result**: Once the subagent returns, inspect its output and integrate it into your work as needed.`);
    }

    if (mode === "PLAN" && !isSubagent) {
        parts.push(`
        ## Spawning Subagents
        You can use the **spawnAgent** tool to delegate self-contained research/analysis tasks to a subagent in parallel.
        
        ### Guidelines:
        - **Task description**: Provide a highly descriptive, self-contained task prompt. Crucial: The subagent starts with a completely clean context and has no access to your chat history, files read, or state. You MUST explicitly write down all instructions, file paths to read/write, relevant code snippets, target structures/contracts, and expected output formats in the prompt.
        ${planModelRecommendations}
        - **Mode selection**: You are in PLAN (read-only) mode. You MUST set the subagent's mode to \"PLAN\" as well. Spawning a BUILD mode subagent from a PLAN parent is not allowed.`);
    }

    const result = parts.join("\n");

    if (promptCache.size >= MAX_PROMPT_CACHE_SIZE) {
        const firstKey = promptCache.keys().next().value;
        if (firstKey) promptCache.delete(firstKey);
    }
    promptCache.set(key, result);

    return result;
}
