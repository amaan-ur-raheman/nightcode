import { relative, join } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';
import { toolInputSchemas, type ModeType } from '@nightcode/shared';
import { getValidAuth } from '@/lib/auth';
import {
    registerSubagent,
    removeSubagent,
    completeSubagent,
    getCurrentToolCallContext,
    consumeExecutionContext,
} from '@/lib/subagent-progress';
import { runSubagentLoop } from '@/lib/subagent-loop';
import {
    resolveProviderFallback,
    extractProvider,
    type AgentRole,
} from '@/lib/model-utils';
import {
    waitForSlot,
    releaseSlot,
    recordProviderLatency,
} from '@/lib/concurrency-limit';
import { undoManager } from '@/lib/undo-manager';
import { runGit } from './utils';
import { getProjectCwd } from '@/lib/workspace-context';

const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_STEPS = 100;

export interface DelegationAdvice {
    recommendation: 'direct' | 'subagent' | 'orchestrate_task';
    rationale: string[];
    suggestedSubagentType?: string;
    preset?: string;
    suggestedFiles?: string[];
    estimatedFileCount?: number;
}

function analyzeTask(task: string): DelegationAdvice {
    const lower = task.toLowerCase();
    const rationale: string[] = [];

    const hasMultiFileRefs = (
        task.match(
            /\.(ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)(?::\d+)?/g,
        ) || []
    ).length;
    const hasTestRequest =
        /\b(tests?|specs?|unit tests?|integration tests?)\b/i.test(lower);
    const hasDebugRequest =
        /\b(debug(?:ging)?|bug|fix(?:ed|es|ing)?|broken|error|issues?|failing)\b/i.test(
            lower,
        );
    const hasRefactorRequest =
        /\b(refactor(?:ing)?|clean(?:up)?|extract|simplify|restructure)\b/i.test(
            lower,
        );
    const hasReviewRequest =
        /\b(review|audit|check for bugs|security review)\b/i.test(lower);
    const hasMultiStepMarker =
        /\b(and then|then|followed by|after that|also|additionally|meanwhile|subsequently)\b/i.test(
            lower,
        );
    const hasResearchRequest =
        /\b(research|investigate|understand(?:ing)?|how does|explain|document(?:ation|ed)?)\b/i.test(
            lower,
        );
    const hasConcreteAction =
        /\b(create|implement|build|add|write|modify|edit|change|update)\b/i.test(
            lower,
        );

    const estimatedFileCount = hasMultiFileRefs;

    if (
        hasMultiFileRefs <= 2 &&
        !hasMultiStepMarker &&
        !hasTestRequest &&
        !hasRefactorRequest &&
        !hasReviewRequest &&
        !hasDebugRequest &&
        !hasResearchRequest
    ) {
        rationale.push(
            'Task references 1-2 files with no multi-step markers or complex subtasks.',
        );
        rationale.push(
            'Use direct tool calls — this is straightforward enough to do yourself.',
        );
        return { recommendation: 'direct', rationale, estimatedFileCount };
    }

    if (hasResearchRequest && !hasConcreteAction) {
        rationale.push(
            'Task is research/investigation oriented with no concrete implementation action.',
        );
        rationale.push(
            'Use spawn_agent with the researcher preset to explore the codebase in PLAN mode.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawn_agent',
            preset: 'researcher',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    if (hasReviewRequest) {
        rationale.push('Task requires code review.');
        rationale.push(
            'Use spawn_agent with the reviewer preset — it has an optimized prompt for structured review.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawn_agent',
            preset: 'reviewer',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    if (hasDebugRequest) {
        rationale.push('Task involves debugging or fixing a bug.');
        rationale.push(
            'Use spawn_agent with the debugger preset — it will investigate, diagnose, and fix the root cause.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawn_agent',
            preset: 'debugger',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    if (hasTestRequest) {
        rationale.push('Task involves writing tests.');
        rationale.push(
            'Use spawn_agent with the tester preset — it has an optimized prompt for test generation.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawn_agent',
            preset: 'tester',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    if (hasRefactorRequest) {
        rationale.push('Task involves refactoring code.');
        rationale.push(
            'Use spawn_agent with the refactor preset — it specializes in behavior-preserving code changes.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawn_agent',
            preset: 'refactor',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    if (hasMultiFileRefs >= 3 || hasMultiStepMarker) {
        rationale.push(
            `Task references ${hasMultiFileRefs} files or has multi-step markers.`,
        );
        const hasTestComponent = hasTestRequest;
        const hasImplementation = hasConcreteAction;
        if (hasTestComponent && hasImplementation) {
            rationale.push(
                'Combines implementation + testing — good candidate for orchestrate_task with parallel coder + tester roles.',
            );
        } else {
            rationale.push(
                'Multiple files and steps involved — orchestrate_task can parallelize this work.',
            );
        }
        rationale.push(
            'Use the orchestrate_task tool to decompose and execute in parallel.',
        );
        return {
            recommendation: 'orchestrate_task',
            rationale,
            estimatedFileCount,
        };
    }

    if (hasMultiFileRefs >= 2 || hasMultiStepMarker) {
        rationale.push(
            'Task has moderate complexity with multiple steps or files.',
        );
        rationale.push(
            'Consider a spawn_agent call if it is self-contained, or orchestrate_task if it spans many files.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawn_agent',
            preset: 'none',
            estimatedFileCount,
        };
    }

    rationale.push(
        'No strong complexity signals detected. Direct tool calls should suffice.',
    );
    return { recommendation: 'direct', rationale, estimatedFileCount };
}

function resolveModel(
    explicitModel: string | undefined,
    parentModel: string | undefined,
    role: AgentRole,
): string {
    if (explicitModel) return explicitModel;
    if (parentModel) return parentModel;
    return resolveProviderFallback(parentModel, role);
}

export async function injectWorkspaceContext(
    task: string,
    cwd: string,
): Promise<string> {
    const recentFiles = new Set<string>();
    const gitLogLines: string[] = [];
    const projectStructure: string[] = [];
    const fileSummaries: string[] = [];

    try {
        const undoHistory = undoManager.getHistory();
        for (const entry of undoHistory) {
            if (entry.filePath) {
                const rel = relative(cwd, entry.filePath);
                if (!rel.startsWith('..')) {
                    recentFiles.add(rel);
                }
            }
        }
    } catch {}

    try {
        const gitRes = await runGit(cwd, ['status', '--porcelain']);
        if (gitRes && gitRes.stdout) {
            const lines = gitRes.stdout.split('\n');
            for (const line of lines) {
                if (line.length < 3) continue;
                const rest = line.substring(3);
                const arrowIdx = rest.indexOf(' -> ');
                const file =
                    arrowIdx !== -1 ? rest.substring(arrowIdx + 4) : rest;
                if (file) {
                    recentFiles.add(file);
                }
            }
        }
    } catch {}

    try {
        const logRes = await runGit(cwd, [
            'log',
            '--oneline',
            '-5',
            '--format=%h %s',
        ]);
        if (logRes && logRes.stdout) {
            gitLogLines.push(
                ...logRes.stdout
                    .split('\n')
                    .filter((l) => l.trim())
                    .slice(0, 5),
            );
        }
    } catch {}

    try {
        const entries = readdirSync(cwd).filter(
            (e) => !e.startsWith('.') && e !== 'node_modules',
        );
        for (const entry of entries.slice(0, 15)) {
            try {
                const st = statSync(join(cwd, entry));
                projectStructure.push(st.isDirectory() ? `${entry}/` : entry);
            } catch {}
        }
    } catch {}

    const fileArray = Array.from(recentFiles).slice(0, 5);
    for (const filePath of fileArray) {
        try {
            const absPath = join(cwd, filePath);
            const content = readFileSync(absPath, 'utf-8');
            if (content.includes('\0')) continue;
            const firstLines = content
                .split('\n')
                .slice(0, 3)
                .join('\n')
                .trim();
            if (firstLines) {
                fileSummaries.push(`### ${filePath}\n${firstLines}`);
            }
        } catch {}
    }

    if (
        recentFiles.size === 0 &&
        gitLogLines.length === 0 &&
        projectStructure.length === 0
    ) {
        return task;
    }

    const contextParts = [
        '\n\n## Workspace Context (Auto-injected from parent session)',
    ];

    if (recentFiles.size > 0) {
        contextParts.push(
            `### Recently Modified Files\n${Array.from(recentFiles)
                .map((f) => `- ${f}`)
                .join('\n')}`,
        );
    }

    if (gitLogLines.length > 0) {
        contextParts.push(
            `### Recent Commits\n${gitLogLines.map((l) => `- ${l}`).join('\n')}`,
        );
    }

    if (projectStructure.length > 0) {
        contextParts.push(
            `### Project Structure\n${projectStructure.join('\n')}`,
        );
    }

    if (fileSummaries.length > 0) {
        contextParts.push(`### File Previews\n${fileSummaries.join('\n\n')}`);
    }

    contextParts.push(
        '\nPlease focus on these files or inspect them if they are relevant to your task.',
    );

    return task + contextParts.join('\n');
}

export async function spawnAgentTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const parsed = toolInputSchemas.spawn_agent.parse(input);
    const { shouldDelegateTask } = parsed;

    if (shouldDelegateTask) {
        return analyzeTask(shouldDelegateTask);
    }

    let task = parsed.task;
    let model = parsed.model;
    let mode = parsed.mode;
    const { preset, files, focus, testFramework, instructions, question } =
        parsed;

    if (preset === 'reviewer') {
        const focusNote = focus ? ` Focus especially on: ${focus}.` : '';
        task = `You are an expert code reviewer. Review the following files for bugs, logic errors, security vulnerabilities, and best practices.${focusNote}\n\nFiles to review:\n${(files ?? []).map((f) => `- ${f}`).join('\n')}\n\nFor each file, read it and provide a structured review covering:\n1. Bugs or logic errors\n2. Security issues\n3. Performance concerns\n4. Code quality / best practices\n5. Suggested improvements\n\nAfter reviewing individual files, check for cross-file issues:\n- Interface mismatches between modules\n- Inconsistent error handling patterns\n- Duplicated logic that should be shared\n\nFormat each finding as:\n- **[CRITICAL]** — bugs, security issues, data loss risks\n- **[WARNING]** — performance, maintainability, code quality\n- **[INFO]** — style suggestions, minor improvements\n\nFocus on actionable findings. Skip issues that are already handled well.\n\nIMPORTANT: You MUST write your review as text. Do not stop after tool calls.`;
        mode = 'PLAN';
        model = resolveModel(model, parentModel, 'codeReviewer');
    } else if (preset === 'tester') {
        const frameworkNote = testFramework
            ? ` Use ${testFramework} as the test framework.`
            : '';
        task = `You are an expert test engineer. Write comprehensive tests for the following files.${frameworkNote}\n\nFiles to write tests for:\n${(files ?? []).map((f) => `- ${f}`).join('\n')}\n\nFor each file:\n1. Read the file to understand what it does\n2. Check for existing test files in the project — match their style, framework, and conventions\n3. Write tests covering: happy paths, edge cases, and error conditions\n4. Place test files alongside the source files (e.g. foo.ts → foo.test.ts)\n5. Run the tests after writing them to verify they pass\n6. If tests fail, fix the test code (not the source) unless you find a genuine source bug\n\nWhen writing tests, prefer:\n- Descriptive test names that explain the scenario\n- Arrange-Act-Assert pattern\n- Testing one behavior per test case\n- Using project-specific test utilities and fixtures\n\nIMPORTANT: After writing tests, summarise what you wrote as text. Do not stop after tool calls.`;
        mode = 'BUILD';
        model = resolveModel(model, parentModel, 'testWriter');
    } else if (preset === 'debugger') {
        const filesNote =
            files && files.length > 0
                ? `\n\nRelevant files to start from:\n${files.map((f) => `- ${f}`).join('\n')}`
                : '';
        task = `You are an expert debugger. Investigate and fix the following bug.\n\nBug description: ${task}${filesNote}\n\nSteps:\n1. Search for relevant code using grep, codeSearch, or glob\n2. Read the files to understand the issue and its context\n3. Check for related tests, error logs, or configuration issues\n4. Diagnose the root cause — trace the execution path\n5. Implement the minimal fix that addresses the root cause\n6. Verify the fix by running relevant tests or the application\n7. If the fix is complex, add a regression test\n\nReport back with:\n- Root cause explanation\n- What you changed and why\n- How to verify the fix\n\nIMPORTANT: You MUST write your summary as text. Do not stop after tool calls.`;
        mode = 'BUILD';
        model = resolveModel(model, parentModel, 'debugger');
    } else if (preset === 'refactor') {
        if (!instructions)
            throw new Error('instructions are required for refactor preset');
        task = `You are an expert software engineer specialising in refactoring. Refactor the following files without changing their external behaviour.\n\nFiles to refactor:\n${(files ?? []).map((f) => `- ${f}`).join('\n')}\n\nRefactoring instructions: ${instructions}\n\nSteps:\n1. Read all the files to understand the current structure and dependencies\n2. Check for existing tests — they define the contract you must preserve\n3. Identify the refactoring opportunities based on the instructions\n4. Make changes incrementally — small, testable steps\n5. Run existing tests after each meaningful change\n6. If tests fail, revert the last change and try a different approach\n7. Verify the final state passes all tests\n\nReport back with:\n- Summary of changes made\n- Files modified\n- Any risks or follow-up items\n\nIMPORTANT: You MUST write your summary as text. Do not stop after tool calls.`;
        mode = 'BUILD';
        model = resolveModel(model, parentModel, 'refactor');
    } else if (preset === 'researcher') {
        if (!question)
            throw new Error('question is required for researcher preset');
        task = `You are a codebase researcher. Answer the following question about this codebase thoroughly.\n\nQuestion: ${question}\n\nSteps:\n1. Use glob, grep, codeSearch, and readFile to explore relevant parts of the codebase\n2. Read the most relevant files — be selective, use grep/codeSearch to find them first, then read deeper as needed\n3. Trace data flows, dependencies, and patterns across files\n4. Return a structured answer with these sections:\n   - **Summary**: 2-3 sentence answer\n   - **Findings**: Detailed analysis with file:line references (e.g., \`src/foo.ts:42\`)\n   - **Architecture Notes**: How this fits into the broader system (if relevant)\n   - **Related Files**: List of files involved or worth examining further\n\nIMPORTANT: You MUST end your response with a written summary. Do not stop after tool calls.`;
        mode = 'PLAN';
        model = resolveModel(model, parentModel, 'researcher');
    }

    const resolvedModel =
        model ?? parentModel ?? resolveProviderFallback(parentModel, 'coder');

    if (parentMode === 'PLAN' && mode === 'BUILD') {
        throw new Error(
            'Cannot spawn a BUILD mode subagent from a PLAN mode parent. Please spawn a PLAN mode subagent instead.',
        );
    }

    const auth = await getValidAuth();
    if (!auth) throw new Error('Not authenticated. Run /login to continue.');

    if (!(await waitForSlot(30_000))) {
        throw new Error(
            'Timed out waiting for a concurrency slot. Too many subagents are running.',
        );
    }

    const subagentId = crypto.randomUUID();
    const provider = extractProvider(resolvedModel);
    const toolCallId = execId
        ? consumeExecutionContext(execId)
        : getCurrentToolCallContext();
    registerSubagent(subagentId, task, MAX_STEPS, toolCallId ?? undefined);

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
        () => timeoutController.abort(),
        SUBAGENT_TIMEOUT_MS,
    );

    const combinedController = new AbortController();
    const onTimeout = () =>
        combinedController.abort(timeoutController.signal.reason);
    const onCaller = () => combinedController.abort(signal?.reason);
    timeoutController.signal.addEventListener('abort', onTimeout, {
        once: true,
    });
    signal?.addEventListener('abort', onCaller, { once: true });

    const startTime = Date.now();
    const cwd = getProjectCwd();
    const taskWithContext = await injectWorkspaceContext(task, cwd);

    try {
        const result = await runSubagentLoop({
            prompt: taskWithContext,
            mode: mode as 'BUILD' | 'PLAN',
            model: resolvedModel,
            auth,
            signal: combinedController.signal,
            maxSteps: MAX_STEPS,
            agentId: subagentId,
            label: 'subagent',
        });
        const elapsed = Date.now() - startTime;
        recordProviderLatency(provider, elapsed, true, mode);
        return { result };
    } catch (err: any) {
        const isTimeout = timeoutController.signal.aborted && !signal?.aborted;
        const elapsed = Date.now() - startTime;
        recordProviderLatency(provider, elapsed, false, mode);

        if (isTimeout) {
            const partialResult = (err as any).partialResult;
            completeSubagent(
                subagentId,
                'failed',
                `Timed out after ${SUBAGENT_TIMEOUT_MS / 60000}m`,
            );
            if (partialResult) return { result: partialResult };
            throw new Error(
                `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60000} minutes`,
                { cause: err },
            );
        }

        completeSubagent(subagentId, 'failed', err.message);
        throw err;
    } finally {
        clearTimeout(timeoutId);
        timeoutController.signal.removeEventListener('abort', onTimeout);
        signal?.removeEventListener('abort', onCaller);
        releaseSlot();
        setTimeout(() => removeSubagent(subagentId), 3_000);
    }
}
