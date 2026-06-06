import { toolInputSchemas, type ModeType } from "@nightcode/shared";
import { spawnAgentTool } from "./spawn-agent";

const PRESET_MODELS = {
    codeReviewer: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    testWriter: "stepfun-ai/step-3.7-flash",
    debugger: "moonshotai/kimi-k2.6",
    refactor: "nvidia/nemotron-3-ultra-550b-a55b",
    researcher: "meta/llama-3.3-70b-instruct",
} as const;

export async function spawnCodeReviewerTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
) {
    const { files, focus, model } = toolInputSchemas.spawnCodeReviewer.parse(input);
    const focusNote = focus ? ` Focus especially on: ${focus}.` : "";
    const task = `You are an expert code reviewer. Review the following files for bugs, logic errors, security vulnerabilities, and best practices.${focusNote}

Files to review:
${files.map(f => `- ${f}`).join("\n")}

For each file, read it and provide a structured review covering:
1. Bugs or logic errors
2. Security issues
3. Performance concerns
4. Code quality / best practices
5. Suggested improvements

Be specific — reference line numbers or code blocks where relevant.

IMPORTANT: You MUST write your review as text. Do not stop after tool calls.`;

    return spawnAgentTool({ task, model: model ?? PRESET_MODELS.codeReviewer, mode: "PLAN" }, parentMode, parentModel, signal);
}

export async function spawnTestWriterTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
) {
    const { files, testFramework, model } = toolInputSchemas.spawnTestWriter.parse(input);
    const frameworkNote = testFramework ? ` Use ${testFramework} as the test framework.` : "";
    const task = `You are an expert test engineer. Write comprehensive tests for the following files.${frameworkNote}

Files to write tests for:
${files.map(f => `- ${f}`).join("\n")}

For each file:
1. Read the file to understand what it does
2. Write tests covering: happy paths, edge cases, and error conditions
3. Place test files alongside the source files (e.g. foo.ts → foo.test.ts)
4. Run the tests after writing them to verify they pass

IMPORTANT: After writing tests, summarise what you wrote as text. Do not stop after tool calls.`;

    return spawnAgentTool({ task, model: model ?? PRESET_MODELS.testWriter, mode: "BUILD" }, parentMode, parentModel, signal);
}

export async function spawnDebuggerTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
) {
    const { description, files, model } = toolInputSchemas.spawnDebugger.parse(input);
    const filesNote = files && files.length > 0
        ? `\n\nRelevant files to start from:\n${files.map(f => `- ${f}`).join("\n")}`
        : "";
    const task = `You are an expert debugger. Investigate and fix the following bug.

Bug description: ${description}${filesNote}

Steps:
1. Read the relevant files to understand the code
2. Trace the root cause of the bug
3. Apply a minimal, targeted fix
4. Run tests to verify the fix does not break anything
5. Summarise what the bug was and what you changed

IMPORTANT: You MUST write your summary as text. Do not stop after tool calls.`;

    return spawnAgentTool({ task, model: model ?? PRESET_MODELS.debugger, mode: "BUILD" }, parentMode, parentModel, signal);
}

export async function spawnRefactorTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
) {
    const { files, instructions, model } = toolInputSchemas.spawnRefactor.parse(input);
    const task = `You are an expert software engineer specialising in refactoring. Refactor the following files without changing their external behaviour.

Files to refactor:
${files.map(f => `- ${f}`).join("\n")}

Refactoring instructions: ${instructions}

Steps:
1. Read the files
2. Apply the requested refactoring
3. Run tests after to confirm behaviour is unchanged
4. Summarise what you changed and why

IMPORTANT: You MUST write your summary as text. Do not stop after tool calls.`;

    return spawnAgentTool({ task, model: model ?? PRESET_MODELS.refactor, mode: "BUILD" }, parentMode, parentModel, signal);
}

export async function spawnResearcherTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
) {
    const { question, model } = toolInputSchemas.spawnResearcher.parse(input);
    const task = `You are a codebase researcher. Answer the following question about this codebase thoroughly.

Question: ${question}

Steps:
1. Use glob, grep, codeSearch, and readFile to explore relevant parts of the codebase
2. Read at most 5 files — be selective, use grep/codeSearch to find the most relevant ones first
3. Trace data flows, dependencies, and patterns as needed
4. Return a clear, well-structured answer with file paths and code references

IMPORTANT: You MUST end your response with a written summary. Do not stop after tool calls.`;

    return spawnAgentTool({ task, model: model ?? PRESET_MODELS.researcher, mode: "PLAN" }, parentMode, parentModel, signal);
}
