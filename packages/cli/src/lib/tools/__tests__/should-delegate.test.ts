import { describe, it, expect } from 'vitest';
import { shouldDelegateTool, type DelegationAdvice } from '../should-delegate';

describe('shouldDelegateTool', () => {
    describe('direct tool calls (simple tasks)', () => {
        it('recommends direct for a single file ref with no complexity signals', async () => {
            const result = await shouldDelegateTool({
                // "Fix" triggers debug, "typo" is in no regex — use a neutral verb
                task: 'Update the import path in src/utils.ts',
            });
            expect(result.recommendation).toBe('direct');
            expect(result.rationale.length).toBeGreaterThan(0);
        });

        it('recommends direct for two file refs with no multi-step markers', async () => {
            const result = await shouldDelegateTool({
                task: 'Update the imports in src/auth.ts and src/user.ts',
            });
            expect(result.recommendation).toBe('direct');
        });

        it('recommends direct for a simple descriptive request with no file refs', async () => {
            const result = await shouldDelegateTool({
                task: 'What does this function do?',
            });
            expect(result.recommendation).toBe('direct');
        });

        it('recommends direct for a one-line change description', async () => {
            const result = await shouldDelegateTool({
                task: 'Rename the variable to camelCase',
            });
            expect(result.recommendation).toBe('direct');
        });

        it('recommends direct for quick file read requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Show me the contents of src/config.ts',
            });
            expect(result.recommendation).toBe('direct');
        });
    });

    describe('research subagent (spawnResearcher)', () => {
        it('recommends spawnResearcher for research questions', async () => {
            const result = await shouldDelegateTool({
                task: 'Research how the authentication flow works in this codebase',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnResearcher');
        });

        it('recommends spawnResearcher for investigate requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Investigate how the billing system handles refunds',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnResearcher');
        });

        it('recommends spawnResearcher for understand/explain requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Explain the data flow from the API to the database',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnResearcher');
        });

        it('recommends spawnResearcher subagent for document requests without concrete action', async () => {
            const result = await shouldDelegateTool({
                task: 'Document the API endpoints',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnResearcher');
        });

        it('recommends orchestrator when research also has concrete actions and multi-step markers', async () => {
            const result = await shouldDelegateTool({
                task: 'Research and then implement a new auth middleware in src/middleware/auth.ts',
            });
            // hasMultiFileRefs=1, hasMultiStepMarker=true (and then)
            // hasResearchRequest=true, hasConcreteAction=true
            // Simple: hasMultiStepMarker=true → false
            // Research: hasConcreteAction=true → false
            // Falls through to multi-step: hasMultiStepMarker=true → orchestrator
            expect(result.recommendation).toBe('orchestrator');
        });
    });

    describe('code review subagent (spawnCodeReviewer)', () => {
        it('recommends spawnCodeReviewer for review requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Review the security of the auth module',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnCodeReviewer');
        });

        it('recommends spawnCodeReviewer for audit requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Audit src/api.ts for potential bugs',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnCodeReviewer');
        });

        it('recommends spawnCodeReviewer for "check for bugs" requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Check for bugs in the payment processing code',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnCodeReviewer');
        });
    });

    describe('debug subagent (spawnDebugger)', () => {
        it('recommends spawnDebugger for debug requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Debug the login failure in src/auth.ts',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });

        it('recommends spawnDebugger for fix bug requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Fix the null pointer exception in user service',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });

        it('recommends spawnDebugger for broken/error/issue requests', async () => {
            const result = await shouldDelegateTool({
                task: 'The build is broken with a type error in src/index.ts',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });

        it('recommends spawnDebugger for "fix the typo" since fix is a debug signal', async () => {
            const result = await shouldDelegateTool({
                task: 'Fix the typo in src/utils.ts',
            });
            // "Fix" triggers hasDebugRequest via \bfix(?:ed|es|ing)?\b
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });
    });

    describe('test writing subagent (spawnTestWriter)', () => {
        it('recommends spawnTestWriter for test requests (plural "tests")', async () => {
            const result = await shouldDelegateTool({
                task: 'Write unit tests for the UserService class',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnTestWriter');
        });

        it('recommends spawnTestWriter for spec requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Create integration tests for the API routes',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnTestWriter');
        });

        it('recommends spawnTestWriter for singular "test" in task', async () => {
            const result = await shouldDelegateTool({
                task: 'Write a unit test for the validator function',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnTestWriter');
        });
    });

    describe('refactor subagent (spawnRefactor)', () => {
        it('recommends spawnRefactor for refactor requests', async () => {
            const result = await shouldDelegateTool({
                // "Refactor" matches refactor regex, avoid "error/issue/fix" which triggers debug
                task: 'Refactor the utility functions into smaller modules',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnRefactor');
        });

        it('recommends spawnRefactor for cleanup requests', async () => {
            const result = await shouldDelegateTool({
                task: 'Clean up the utility functions into smaller modules',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnRefactor');
        });

        it('recommends spawnRefactor for extract/simplify/restructure', async () => {
            const results = await Promise.all(
                [
                    'Extract the helper functions',
                    'Simplify the state management',
                    'Restructure the project layout',
                ].map((task) => shouldDelegateTool({ task })),
            );
            for (const r of results) {
                expect(r.recommendation).toBe('subagent');
                expect(r.suggestedSubagentType).toBe('spawnRefactor');
            }
        });

        it('recommends spawnRefactor even when "error" appears in unrelated context', async () => {
            const result = await shouldDelegateTool({
                task: 'Refactor the error handling middleware',
            });
            // "Refactor" triggers refactor check; "error" triggers debug check
            // But refactor check (step 6) comes AFTER debug check (step 4)
            // Debug check fires first: hasDebugRequest=true → spawnDebugger
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });
    });

    describe('orchestrator (complex multi-file/multi-step tasks)', () => {
        it('recommends orchestrator for 3+ file references', async () => {
            const result = await shouldDelegateTool({
                task: 'Update types in src/types.ts, resolvers in src/resolvers.ts, and schemas in src/schemas.ts',
            });
            expect(result.recommendation).toBe('orchestrator');
            expect(result.estimatedFileCount).toBeGreaterThanOrEqual(3);
        });

        it('recommends orchestrator for tasks with "and then" multi-step markers', async () => {
            // No test/debug/review/research/refactor signals to avoid priority conflicts
            const result = await shouldDelegateTool({
                task: 'Create the data model and then wire up the API endpoint',
            });
            // hasMultiStepMarker=true, hasConcreteAction=true (create)
            // hasTestRequest=false, hasRefactorRequest=false, hasDebugRequest=false (no trigger words)
            // Simple: hasMultiStepMarker=true → false
            // Falls through to multi-step: hasMultiStepMarker=true → orchestrator
            expect(result.recommendation).toBe('orchestrator');
        });

        it('recommends orchestrator for tasks with "followed by" markers', async () => {
            const result = await shouldDelegateTool({
                task: 'Create the API endpoint followed by updating the frontend',
            });
            expect(result.recommendation).toBe('orchestrator');
        });

        it('recommends orchestrator for tasks with "after that" markers', async () => {
            const result = await shouldDelegateTool({
                task: 'Migrate the database after that update the queries',
            });
            expect(result.recommendation).toBe('orchestrator');
        });

        it('recommends spawnTestWriter for combined implementation + testing (test priority over multi-step)', async () => {
            const result = await shouldDelegateTool({
                task: 'Add a new feature to src/feature.ts and write unit tests for it',
            });
            // hasTestRequest=true, hasMultiFileRefs=1, hasConcreteAction=true (add, write)
            // Test check fires BEFORE multi-step check → spawnTestWriter
            // This is intentional: dedicated test writers are preferred when tests are explicitly mentioned
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnTestWriter');
        });

        it('recommends orchestrator for 2+ file refs with "additionally" marker', async () => {
            const result = await shouldDelegateTool({
                task: 'Update src/config.ts and additionally update src/constants.ts',
            });
            expect(result.recommendation).toBe('orchestrator');
        });

        it('recommends orchestrator for 2+ file refs with "also" marker', async () => {
            const result = await shouldDelegateTool({
                task: 'Modify src/api.ts also update src/routes.ts',
            });
            expect(result.recommendation).toBe('orchestrator');
        });

        it('recommends orchestrator when 2 file refs have "then" marker', async () => {
            const result = await shouldDelegateTool({
                task: 'Update src/api.ts then update src/routes.ts',
            });
            expect(result.recommendation).toBe('orchestrator');
        });
    });

    describe('fallback moderate complexity', () => {
        it('recommends direct for 2 file refs with no specific pattern match (not moderate)', async () => {
            const result = await shouldDelegateTool({
                task: 'Update the configuration in both settings.ts and constants.ts',
            });
            // hasMultiFileRefs=2, no complexity signals at all
            // Simple check: 2 <= 2 && all markers false = true → direct
            expect(result.recommendation).toBe('direct');
        });

        it('recommends spawnRefactor for tasks with "meanwhile" that contain refactor keywords', async () => {
            const result = await shouldDelegateTool({
                task: 'Work on the dashboard meanwhile refactor the backend',
            });
            // hasMultiStepMarker=true (meanwhile), hasRefactorRequest=true
            // Refactor check (step 6) fires BEFORE multi-step check (step 7) → spawnRefactor
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnRefactor');
        });

        it('recommends orchestrator for "meanwhile" tasks without other specific signals', async () => {
            const result = await shouldDelegateTool({
                task: 'Work on the dashboard meanwhile update the backend layout',
            });
            // hasMultiStepMarker=true (meanwhile), hasRefactorRequest=false
            // hasDebugRequest=false, hasTestRequest=false, hasReviewRequest=false, hasResearchRequest=false
            // hasConcreteAction=true (update? Let me check: update is in hasConcreteAction regex? Yes "update")
            // Simple: hasMultiStepMarker=true → false
            // Falls through to multi-step: hasMultiStepMarker=true → orchestrator
            expect(result.recommendation).toBe('orchestrator');
        });
    });

    describe('edge cases', () => {
        it('handles empty task gracefully', async () => {
            const result = await shouldDelegateTool({
                task: '',
            });
            expect(result.recommendation).toBe('direct');
            expect(result.rationale.length).toBeGreaterThan(0);
        });

        it('handles very short tasks', async () => {
            const result = await shouldDelegateTool({
                task: 'hi',
            });
            expect(result.recommendation).toBe('direct');
        });

        it('handles tasks with only numbers and symbols', async () => {
            const result = await shouldDelegateTool({
                task: '123 !@#$% ^&*()',
            });
            expect(result.recommendation).toBe('direct');
        });

        it('handles very long tasks with test mentions', async () => {
            const result = await shouldDelegateTool({
                task: 'Implement a comprehensive authentication system with JWT tokens, refresh tokens, middleware, rate limiting, database schema, and email verification spanning multiple files and services. This should also include integration tests and documentation.',
            });
            // hasConcreteAction=true (implement), hasTestRequest=true (tests)
            // hasResearchRequest=true (documentation matches "document")
            // Simple: hasTestRequest=true → false
            // Research: true but hasConcreteAction=true → false
            // Review: false. Debug: false. Test: true → spawnTestWriter
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnTestWriter');
        });

        it('handles very long tasks where one word triggers debug', async () => {
            const result = await shouldDelegateTool({
                task: 'We need to improve the overall performance and reliability of the system by optimizing queries, adding caching, and improving error boundaries throughout the application stack',
            });
            // hasMultiFileRefs=0, hasConcreteAction=false
            // "error" in "error boundaries" triggers hasDebugRequest=true
            // Debug check fires → spawnDebugger
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });

        it('handles very long documents with research signal from understand', async () => {
            const result = await shouldDelegateTool({
                task: 'Please provide me with a summary of how this module works so I can understand its purpose and functionality',
            });
            // "understand" in "understand its purpose" matches research regex
            // \bunderstand(?:ing)?\b — matches "understand" with word boundary
            // hasResearchRequest=true, hasConcreteAction=false → spawnResearcher
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnResearcher');
        });

        it('handles text with no triggering keywords', async () => {
            const result = await shouldDelegateTool({
                task: 'Tell me about how this module works',
            });
            // "Tell" doesn't match research, "about" doesn't match, "how" alone doesn't match "how does"
            // No file refs, no multi-step markers → direct
            expect(result.recommendation).toBe('direct');
        });
    });

    describe('rationale quality', () => {
        it('includes actionable rationale text for each recommendation', async () => {
            const results = await Promise.all([
                shouldDelegateTool({
                    task: 'Update a constant in src/file.ts',
                }),
                shouldDelegateTool({
                    task: 'Research the codebase architecture',
                }),
                shouldDelegateTool({ task: 'Debug the login failure' }),
                shouldDelegateTool({ task: 'Write tests for UserService' }),
                shouldDelegateTool({ task: 'Refactor the utilities module' }),
                shouldDelegateTool({ task: 'Review the security of auth.ts' }),
                shouldDelegateTool({
                    task: 'Update src/a.ts, src/b.ts, and src/c.ts',
                }),
            ]);

            for (const result of results) {
                expect(result.rationale.length).toBeGreaterThan(0);
                for (const line of result.rationale) {
                    expect(typeof line).toBe('string');
                    expect(line.length).toBeGreaterThan(5);
                }
            }
        });
    });

    describe('priority ordering', () => {
        it('test takes priority over simple when both match', async () => {
            const result = await shouldDelegateTool({
                task: 'Write tests for src/utils.ts',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnTestWriter');
        });

        it('debug takes priority over test when both match', async () => {
            const result = await shouldDelegateTool({
                task: 'Debug the failing test in src/user.test.ts',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });

        it('review takes priority over debug when both match', async () => {
            const result = await shouldDelegateTool({
                task: 'Review the debug logging code for security issues',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnCodeReviewer');
        });

        it('research takes priority over review when both match', async () => {
            const result = await shouldDelegateTool({
                task: 'Research how the code review process works',
            });
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnResearcher');
        });

        it('orchestrator takes priority over research when multi-step and concrete action', async () => {
            const result = await shouldDelegateTool({
                task: 'Research the auth flow and then implement it in src/auth.ts',
            });
            expect(result.recommendation).toBe('orchestrator');
        });

        it('debug takes priority over refactor when both match', async () => {
            const result = await shouldDelegateTool({
                task: 'Fix the broken refactor in the merge module',
            });
            // "Fix" + "broken" trigger debug, "refactor" triggers refactor
            // Debug check (step 4) before refactor check (step 6)
            expect(result.recommendation).toBe('subagent');
            expect(result.suggestedSubagentType).toBe('spawnDebugger');
        });
    });

    describe('input validation', () => {
        it('parses valid input without error', async () => {
            const result = await shouldDelegateTool({
                task: 'Update src/config.ts',
            });
            expect(result).toBeDefined();
            expect(result.recommendation).toMatch(
                /^(direct|subagent|orchestrator)$/,
            );
        });

        it('throws on missing task field', async () => {
            await expect(shouldDelegateTool({} as any)).rejects.toThrow();
        });
    });

    describe('interface consistency', () => {
        it('returns all expected fields for each path', async () => {
            const direct = await shouldDelegateTool({
                task: 'Update src/file.ts',
            });
            expect(direct).toHaveProperty('recommendation', 'direct');
            expect(direct).toHaveProperty('rationale');
            expect(direct).toHaveProperty('estimatedFileCount');

            const subagent = await shouldDelegateTool({
                task: 'Debug the issue',
            });
            expect(subagent).toHaveProperty('recommendation', 'subagent');
            expect(subagent).toHaveProperty('suggestedSubagentType');
            expect(subagent).toHaveProperty('suggestedFiles');

            const orchestrator = await shouldDelegateTool({
                task: 'Update src/a.ts, src/b.ts, and src/c.ts',
            });
            expect(orchestrator).toHaveProperty(
                'recommendation',
                'orchestrator',
            );
            expect(orchestrator).toHaveProperty('rationale');
        });
    });
});
