import { type ModeType, Mode } from '@nightcode/shared';

/**
 * Pre-flight Triage: Analyzes the user's request before it reaches the LLM
 * and injects a system notice suggesting delegation when appropriate.
 * This works regardless of the model's natural bias to do everything itself.
 */
export function triageRequest(userText: string, mode: ModeType): string | null {
    if (mode === Mode.PLAN) return null;

    const lower = userText.toLowerCase();

    // Count source file references
    const fileRefs = (
        userText.match(
            /\.(ts|tsx|js|jsx|py|go|rs|rb|java|css|html|json|yaml|yml|md)(?::\d+)?/g,
        ) || []
    ).length;

    // Detect multi-step markers
    const hasMultiStep =
        /\b(and then|then |followed by|after that|additionally|meanwhile|also test|and test|and verify|and review|and debug)\b/i.test(
            lower,
        );

    // Detect test-related requests
    const hasTestRequest =
        /\b(write test|add test|create test|unit test|integration test|test for|spec for)\b/i.test(
            lower,
        );

    // Detect combined concerns (implement + test, refactor + test)
    const hasImplementation =
        /\b(implement|create|build|add|write|refactor|modify|change)\b/i.test(
            lower,
        );
    const hasCombinedConcerns = hasImplementation && hasTestRequest;

    // Detect debugging
    const hasDebugRequest =
        /\b(debug|fix the bug|investigate .* issue|root cause|why is .* broken|trace .* error)\b/i.test(
            lower,
        );

    // Detect research
    const hasResearchRequest =
        /\b(research|investigate|understand how|how does|explain the architecture|document|analyze)\b/i.test(
            lower,
        ) && !hasImplementation;

    // Detect code review
    const hasReviewRequest =
        /\b(review|audit|check for bugs|security review|code quality)\b/i.test(
            lower,
        );

    // Build triage notice
    const notices: string[] = [];

    // 3+ files or multi-step = orchestrator territory
    if (fileRefs >= 3 || hasCombinedConcerns) {
        notices.push(
            `[Suggestion: This request involves ${fileRefs >= 3 ? `${fileRefs} files` : 'both implementation and testing'}. Consider using the \`orchestrate_task\` tool to decompose this into parallel subtasks (e.g., coder + tester roles).]`,
        );
    } else if (hasMultiStep && fileRefs >= 2) {
        notices.push(
            `[Suggestion: This request has multiple steps across ${fileRefs} files. Consider using the \`orchestrate_task\` tool to execute steps in parallel.]`,
        );
    }

    // Subagent territory
    if (hasTestRequest && fileRefs <= 2 && !hasCombinedConcerns) {
        notices.push(
            `[Suggestion: For writing tests, consider using the \`spawn_agent\` tool with the \`tester\` preset which has an optimized test-writing prompt.]`,
        );
    }
    if (hasDebugRequest) {
        notices.push(
            `[Suggestion: For debugging, consider using the \`spawn_agent\` tool with the \`debugger\` preset which will investigate root cause and apply a fix autonomously.]`,
        );
    }
    if (hasResearchRequest) {
        notices.push(
            `[Suggestion: For research or investigation, consider using the \`spawn_agent\` tool with the \`researcher\` preset to explore the codebase in PLAN mode.]`,
        );
    }
    if (hasReviewRequest) {
        notices.push(
            `[Suggestion: For code review, consider using the \`spawn_agent\` tool with the \`reviewer\` preset which produces structured review reports.]`,
        );
    }

    // General reminder for moderately complex tasks
    if (notices.length === 0 && fileRefs >= 2 && hasMultiStep) {
        notices.push(
            `[Suggestion: This task involves multiple files and steps. If it feels too large to handle directly, use \`spawn_agent\` with \`shouldDelegateTask\` for an instant recommendation on which tool to use.]`,
        );
    }

    if (notices.length === 0) return null;
    return notices.join('\n');
}
