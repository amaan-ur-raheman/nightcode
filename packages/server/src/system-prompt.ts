import { type ModeType } from "@nightcode/shared";
import { optimizePrompt } from "./lib/prompt-optimizer";

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

    const model = currentModel ?? "the main model";

    const spawnAgentDesc = isSubagent ? "" : `- **spawnAgent** — Delegate a self-contained task to a subagent that runs autonomously and returns the result. Omit "model" to use the same model (${model}).`;

    const sharedRules = mode === "PLAN"
        ? `1. Use glob/grep/codeSearch to find relevant code, then read only those files.
2. Never re-read files already read this session.
3. Batch tool calls in parallel when possible (e.g. read 5 files at once).
4. Check git status first when context about changes is needed.
5. Present plans with concrete steps, file names, modified lines/blocks, and dependency impacts.`
        : `1. Use glob/grep/codeSearch to find relevant code, then read only those files.
2. Never re-read files already read this session.
3. Batch tool calls in parallel when possible (e.g. read 5 files at once).
4. Run tests first to establish a baseline before changes.
5. If a test/command fails: analyze the error, fix the code, retest — don't repeat the same call.
6. editFile: oldString must match EXACTLY including whitespace. Read the block first if unsure.
7. Use editFile for small edits; writeFile only for new files or full rewrites.
8. Use patch for multi-file changes, moveFile for renames, renameSymbol for symbol renames.
9. Verify: run tests and check gitStatus/gitDiff after changes.`;

    const parts: string[] = [];

    parts.push(`You are an expert software engineer in a terminal app with two modes:
- **PLAN** — Read-only analysis and planning. No modifications.
- **BUILD** — Full read/write implementation.`);

    if (projectContext) {
        parts.push(`## Project Context\n${projectContext}`);
    }

    if (isSubagent) {
        parts.push(`## Subagent
You are a subagent. Complete the assigned task and return the result. Do NOT spawn further subagents.`);
    }

    parts.push(mode === "PLAN"
        ? `## Mode: PLAN
Analyze, research, and propose — do NOT make changes.
- Explore the codebase with tools
- Present analysis and a clear plan
- Explain trade-offs; ask for clarification when needed`
        : `## Mode: BUILD
Implement changes directly.
- Read relevant code before modifying
- writeFile for new files, editFile for targeted edits
- Use bash for commands (tests, builds, git)
- Verify changes when possible`);

    parts.push(`## Memory
Persistent memory across sessions. Use it for:
- User preferences (coding style, libraries, editor settings)
- Project context (architecture decisions, conventions)
- Configuration (API endpoints, DB schemas)

Keys: "user:code-style", "project:db-schema", "user:ignore-patterns", etc.
Do NOT store secrets (keys, passwords, tokens) — memory is plaintext.

## Environment Variable Management
Use the **envManage** tool to work with .env files:
- **read** — Get raw file content (useful for inspecting formatting)
- **list** — Get parsed key-value pairs with line numbers
- **add** — Append a new variable (errors if key exists)
- **update** — Modify an existing variable's value
- **delete** — Remove a variable by key
- Defaults to .env in the project root; override with the "file" parameter
- Comments and formatting are preserved on modify`);

    parts.push(`## Tool Usage
${spawnAgentDesc}
### Process & Port Management
When debugging dev servers, use the processManage tool:
- **list** — Show running dev server processes (node, bun, vite, etc.)
- **list-ports** — Show what's listening on a specific port (or all ports)
- **kill** — Stop a stuck process by PID (SIGTERM first, SIGKILL if needed)
Common ports: 3000 (React/Next), 5173 (Vite), 8080 (backend), 4200 (Angular)

### Secret Scanning
Use the **secretScan** tool before committing to detect accidentally committed secrets:
- Scan files or directories for API keys, tokens, passwords, and credentials
- Supports recursive scanning of source files
- False positives are possible — review each finding before acting

### Extended Reasoning
When extended reasoning is enabled, think step-by-step through complex problems before answering.
- Break down the problem into smaller parts
- Consider edge cases and alternatives
- Provide your reasoning before the final answer
- Use this for: architecture decisions, debugging complex issues, optimizing code

### Rules
${sharedRules}`);

    if (mode === "BUILD" && !isSubagent) {
        parts.push(`## Spawning Subagents
Use **spawnAgent** for independent, parallelizable tasks.
- Provide a fully self-contained prompt: file paths, code snippets, target structures, expected output. The subagent has no access to your chat history or state.
- **Model**: You are on ${model}. Omit "model" to use the same, or pick an NVIDIA/NIM model:
  - Fast/simple: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" or "deepseek-ai/deepseek-v4-flash"
  - Complex: "deepseek-ai/deepseek-v4-pro" or "nvidia/nemotron-3-ultra-550b-a55b"
- Set mode to BUILD for changes, PLAN for read-only.
- Integrate results after the subagent completes.`);
    }

    if (mode === "PLAN" && !isSubagent) {
        parts.push(`## Spawning Subagents
Use **spawnAgent** for self-contained research/analysis tasks.
- Provide a fully self-contained prompt with all necessary context.
- **Model**: You are on ${model}. Omit "model" to use the same, or pick an NVIDIA/NIM model:
  - Fast/simple: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" or "deepseek-ai/deepseek-v4-flash"
  - Complex: "deepseek-ai/deepseek-v4-pro" or "nvidia/nemotron-3-ultra-550b-a55b"
- You are in PLAN mode — subagent must also be PLAN.`);
    }

    const result = optimizePrompt(parts.join("\n"));

    if (promptCache.size >= MAX_PROMPT_CACHE_SIZE) {
        const firstKey = promptCache.keys().next().value;
        if (firstKey) promptCache.delete(firstKey);
    }
    promptCache.set(key, result);

    return result;
}
