import { toolInputSchemas, type ModeType } from '@nightcode/shared';
import { spawnAgentTool } from './spawn-agent';
import { resolveProviderFallback, type AgentRole } from '@/lib/model-utils';

/**
 * Resolve the model for a preset agent.
 * Priority: AI choice → user's selected model → provider-matched fallback.
 */
function resolveModel(
    explicitModel: string | undefined,
    parentModel: string | undefined,
    role: AgentRole,
): string {
    if (explicitModel) return explicitModel;
    if (parentModel) return parentModel;
    return resolveProviderFallback(parentModel, role);
}

export async function spawnCodeReviewerTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const { files, focus, model } =
        toolInputSchemas.spawnCodeReviewer.parse(input);
    const focusNote = focus ? ` Focus especially on: ${focus}.` : '';
    const task = `You are an expert code reviewer. Review the following files for bugs, logic errors, security vulnerabilities, and best practices.${focusNote}

Files to review:
${files.map((f) => `- ${f}`).join('\n')}

For each file, read it and provide a structured review covering:
1. Bugs or logic errors
2. Security issues
3. Performance concerns
4. Code quality / best practices
5. Suggested improvements

After reviewing individual files, check for cross-file issues:
- Interface mismatches between modules
- Inconsistent error handling patterns
- Duplicated logic that should be shared

Format each finding as:
- **[CRITICAL]** — bugs, security issues, data loss risks
- **[WARNING]** — performance, maintainability, code quality
- **[INFO]** — style suggestions, minor improvements

Focus on actionable findings. Skip issues that are already handled well.

IMPORTANT: You MUST write your review as text. Do not stop after tool calls.`;

    return spawnAgentTool(
        {
            task,
            model: resolveModel(model, parentModel, 'codeReviewer'),
            mode: 'PLAN',
        },
        parentMode,
        parentModel,
        signal,
        execId,
    );
}

export async function spawnTestWriterTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const { files, testFramework, model } =
        toolInputSchemas.spawnTestWriter.parse(input);
    const frameworkNote = testFramework
        ? ` Use ${testFramework} as the test framework.`
        : '';
    const task = `You are an expert test engineer. Write comprehensive tests for the following files.${frameworkNote}

Files to write tests for:
${files.map((f) => `- ${f}`).join('\n')}

For each file:
1. Read the file to understand what it does
2. Check for existing test files in the project — match their style, framework, and conventions
3. Write tests covering: happy paths, edge cases, and error conditions
4. Place test files alongside the source files (e.g. foo.ts → foo.test.ts)
5. Run the tests after writing them to verify they pass
6. If tests fail, fix the test code (not the source) unless you find a genuine source bug

When writing tests, prefer:
- Descriptive test names that explain the scenario
- Arrange-Act-Assert pattern
- Testing one behavior per test case
- Using project-specific test utilities and fixtures

IMPORTANT: After writing tests, summarise what you wrote as text. Do not stop after tool calls.`;

    return spawnAgentTool(
        {
            task,
            model: resolveModel(model, parentModel, 'testWriter'),
            mode: 'BUILD',
        },
        parentMode,
        parentModel,
        signal,
        execId,
    );
}

export async function spawnDebuggerTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const { description, files, model } =
        toolInputSchemas.spawnDebugger.parse(input);
    const filesNote =
        files && files.length > 0
            ? `\n\nRelevant files to start from:\n${files.map((f) => `- ${f}`).join('\n')}`
            : '';
    const task = `You are an expert debugger. Investigate and fix the following bug.

Bug description: ${description}${filesNote}

Steps:
1. Search for relevant code using grep, codeSearch, or glob
2. Read the files to understand the issue and its context
3. Check for related tests, error logs, or configuration issues
4. Diagnose the root cause — trace the execution path
5. Implement the minimal fix that addresses the root cause
6. Verify the fix by running relevant tests or the application
7. If the fix is complex, add a regression test

Report back with:
- Root cause explanation
- What you changed and why
- How to verify the fix

IMPORTANT: You MUST write your summary as text. Do not stop after tool calls.`;

    return spawnAgentTool(
        {
            task,
            model: resolveModel(model, parentModel, 'debugger'),
            mode: 'BUILD',
        },
        parentMode,
        parentModel,
        signal,
        execId,
    );
}

export async function spawnRefactorTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const { files, instructions, model } =
        toolInputSchemas.spawnRefactor.parse(input);
    const task = `You are an expert software engineer specialising in refactoring. Refactor the following files without changing their external behaviour.

Files to refactor:
${files.map((f) => `- ${f}`).join('\n')}

Refactoring instructions: ${instructions}

Steps:
1. Read all the files to understand the current structure and dependencies
2. Check for existing tests — they define the contract you must preserve
3. Identify the refactoring opportunities based on the instructions
4. Make changes incrementally — small, testable steps
5. Run existing tests after each meaningful change
6. If tests fail, revert the last change and try a different approach
7. Verify the final state passes all tests

Report back with:
- Summary of changes made
- Files modified
- Any risks or follow-up items

IMPORTANT: You MUST write your summary as text. Do not stop after tool calls.`;

    return spawnAgentTool(
        {
            task,
            model: resolveModel(model, parentModel, 'refactor'),
            mode: 'BUILD',
        },
        parentMode,
        parentModel,
        signal,
        execId,
    );
}

export async function spawnResearcherTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const { question, model } = toolInputSchemas.spawnResearcher.parse(input);
    const task = `You are a codebase researcher. Answer the following question about this codebase thoroughly.

Question: ${question}

Steps:
1. Use glob, grep, codeSearch, and readFile to explore relevant parts of the codebase
2. Read the most relevant files — be selective, use grep/codeSearch to find them first, then read deeper as needed
3. Trace data flows, dependencies, and patterns across files
4. Return a structured answer with these sections:
   - **Summary**: 2-3 sentence answer
   - **Findings**: Detailed analysis with file:line references (e.g., \`src/foo.ts:42\`)
   - **Architecture Notes**: How this fits into the broader system (if relevant)
   - **Related Files**: List of files involved or worth examining further

IMPORTANT: You MUST end your response with a written summary. Do not stop after tool calls.`;

    return spawnAgentTool(
        {
            task,
            model: resolveModel(model, parentModel, 'researcher'),
            mode: 'PLAN',
        },
        parentMode,
        parentModel,
        signal,
        execId,
    );
}
