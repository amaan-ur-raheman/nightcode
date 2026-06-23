/**
 * shouldDelegate — Advisory Tool for Task Delegation
 *
 * Helps the main agent decide whether a task is simple enough for direct
 * tool calls or complex enough to warrant delegation to subagents or the
 * orchestrator. The model can call this when it's unsure about the best
 * approach, reducing its natural bias to do everything itself.
 *
 * This is a lightweight heuristic analysis — not an LLM call — so it
 * returns instantly without consuming tokens.
 */

import { toolInputSchemas } from '@nightcode/shared';

export interface DelegationAdvice {
    recommendation: 'direct' | 'subagent' | 'orchestrator';
    rationale: string[];
    suggestedSubagentType?: string;
    suggestedFiles?: string[];
    estimatedFileCount?: number;
}

/**
 * Score a task description for complexity and return a delegation recommendation.
 */
function analyzeTask(task: string): DelegationAdvice {
    const lower = task.toLowerCase();
    const rationale: string[] = [];

    // Signal detection
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

    // File references
    const fileExtensions = new Set(
        [
            ...task.matchAll(
                /\.(ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)/g,
            ),
        ].map((m) => m[1]),
    );
    const estimatedFileCount = hasMultiFileRefs;

    // --- Decision tree ---
    // Simple: 1-2 files, single step, no testing/debugging/review/research needed
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

    // Research: any research/investigation task
    if (hasResearchRequest && !hasConcreteAction) {
        rationale.push(
            'Task is research/investigation oriented with no concrete implementation action.',
        );
        rationale.push(
            'Use spawnResearcher to explore the codebase in PLAN mode.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawnResearcher',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    // Review: code review task
    if (hasReviewRequest) {
        rationale.push('Task requires code review.');
        rationale.push(
            'Use spawnCodeReviewer — it has an optimized prompt for structured review.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawnCodeReviewer',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    // Debug: bug fix task
    if (hasDebugRequest) {
        rationale.push('Task involves debugging or fixing a bug.');
        rationale.push(
            'Use spawnDebugger — it will investigate, diagnose, and fix the root cause.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawnDebugger',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    // Test writing
    if (hasTestRequest) {
        rationale.push('Task involves writing tests.');
        rationale.push(
            'Use spawnTestWriter — it has an optimized prompt for test generation.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawnTestWriter',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    // Refactoring
    if (hasRefactorRequest) {
        rationale.push('Task involves refactoring code.');
        rationale.push(
            'Use spawnRefactor — it specializes in behavior-preserving code changes.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawnRefactor',
            suggestedFiles: [],
            estimatedFileCount,
        };
    }

    // Multi-step: 3+ files or multi-step markers or combined actions
    if (hasMultiFileRefs >= 3 || hasMultiStepMarker) {
        rationale.push(
            `Task references ${hasMultiFileRefs} files or has multi-step markers.`,
        );
        const hasTestComponent = hasTestRequest;
        const hasImplementation = hasConcreteAction;
        if (hasTestComponent && hasImplementation) {
            rationale.push(
                'Combines implementation + testing — good candidate for orchestrator with parallel coder + tester roles.',
            );
        } else {
            rationale.push(
                'Multiple files and steps involved — orchestrator can parallelize this work.',
            );
        }
        rationale.push(
            'Use the orchestrator tool to decompose and execute in parallel.',
        );
        return {
            recommendation: 'orchestrator',
            rationale,
            estimatedFileCount,
        };
    }

    // Fallback: moderate complexity
    if (hasMultiFileRefs >= 2 || hasMultiStepMarker) {
        rationale.push(
            'Task has moderate complexity with multiple steps or files.',
        );
        rationale.push(
            'Consider a spawnAgent call if it is self-contained, or the orchestrator if it spans many files.',
        );
        return {
            recommendation: 'subagent',
            rationale,
            suggestedSubagentType: 'spawnAgent',
            estimatedFileCount,
        };
    }

    // Default: direct tool calls
    rationale.push(
        'No strong complexity signals detected. Direct tool calls should suffice.',
    );
    return { recommendation: 'direct', rationale, estimatedFileCount };
}

export async function shouldDelegateTool(
    input: unknown,
): Promise<DelegationAdvice> {
    const { task } = toolInputSchemas.shouldDelegate.parse(input);
    return analyzeTask(task);
}
