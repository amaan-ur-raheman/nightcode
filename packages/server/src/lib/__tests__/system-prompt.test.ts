import { describe, it, expect, vi } from 'vitest';

vi.mock('../providers', () => ({
    getProviderName: (modelId: string) => {
        if (modelId.startsWith('claude') || modelId.includes('anthropic'))
            return 'anthropic';
        if (modelId.startsWith('gpt') || modelId.startsWith('o3'))
            return 'openai';
        if (
            modelId.includes('llama-3.3-70b-versatile') ||
            modelId.includes('mixtral')
        )
            return 'groq';
        return 'nim';
    },
    isModelAvailable: async () => true,
}));

import {
    buildSystemPrompt,
    buildSubagentSystemPrompt,
} from '../../system-prompt';

describe('buildSystemPrompt', () => {
    it('returns a string for BUILD mode', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(100);
    });

    it('returns a string for PLAN mode', () => {
        const prompt = buildSystemPrompt({ mode: 'PLAN' });
        expect(typeof prompt).toBe('string');
        expect(prompt).toContain('PLAN');
    });

    it('includes mode-specific instructions', () => {
        const buildPrompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(buildPrompt).toContain('BUILD');
        expect(buildPrompt).toContain('Implement changes directly');

        const planPrompt = buildSystemPrompt({ mode: 'PLAN' });
        expect(planPrompt).toContain('PLAN');
        expect(planPrompt).toContain('Analyze');
        expect(planPrompt).not.toContain('Implement changes directly');
    });

    it('includes project context when provided', () => {
        const prompt = buildSystemPrompt({
            mode: 'BUILD',
            projectContext: 'This is a Next.js project with Prisma',
        });
        expect(prompt).toContain('Next.js');
        expect(prompt).toContain('Prisma');
    });

    it('caches results for same parameters', () => {
        const first = buildSystemPrompt({
            mode: 'BUILD',
            currentModel: 'gpt-4o',
        });
        const second = buildSystemPrompt({
            mode: 'BUILD',
            currentModel: 'gpt-4o',
        });
        expect(first).toBe(second);
    });

    it('produces different prompts for different modes', () => {
        const buildPrompt = buildSystemPrompt({ mode: 'BUILD' });
        const planPrompt = buildSystemPrompt({ mode: 'PLAN' });
        expect(buildPrompt).not.toBe(planPrompt);
    });

    it('includes subagent section when isSubagent is true', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD', isSubagent: true });
        expect(prompt).toContain('Subagent');
    });

    it('includes spawnAgent section for BUILD mode', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('spawnAgent');
    });

    it('includes current model name in spawnAgent description', () => {
        const prompt = buildSystemPrompt({
            mode: 'BUILD',
            currentModel: 'claude-sonnet-4-20250514',
        });
        expect(prompt).toContain('claude-sonnet-4-20250514');
    });

    it('includes batching guidance in PLAN mode spawning section', () => {
        const prompt = buildSystemPrompt({ mode: 'PLAN' });
        expect(prompt).toContain('Batching');
        expect(prompt).toContain('spawnResearcher');
        expect(prompt).toContain('spawnCodeReviewer');
    });

    it('includes batching guidance in BUILD mode spawning section', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Batching');
        expect(prompt).toContain('spawnTestWriter');
        expect(prompt).toContain('spawnDebugger');
        expect(prompt).toContain('spawnRefactor');
    });

    it('includes parallel tool execution rules in subagent prompt', () => {
        const prompt = buildSubagentSystemPrompt({ mode: 'PLAN' });
        expect(prompt).toContain(
            'Emit ALL independent readFile/glob/grep calls in ONE response',
        );
        expect(prompt).toContain('they execute in parallel');
    });

    it('buildSubagentSystemPrompt includes mode-specific rules', () => {
        const planPrompt = buildSubagentSystemPrompt({ mode: 'PLAN' });
        expect(planPrompt).toContain('Present concrete findings');

        const buildPrompt = buildSubagentSystemPrompt({ mode: 'BUILD' });
        expect(buildPrompt).toContain('Verify changes');
    });

    it('includes git history tools', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('gitLog');
        expect(prompt).toContain('gitBlame');
        expect(prompt).toContain('gitBranch');
        expect(prompt).toContain('gitStatusExtended');
        expect(prompt).toContain('diffFiles');
    });

    it('includes file intelligence tools', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('getOutline');
        expect(prompt).toContain('fileInfo');
        expect(prompt).toContain('createDirectory');
    });

    it('includes web fetch tool', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('webFetch');
    });

    it('includes persistent REPL tool', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('replExecute');
    });

    it('includes keychain tools', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('keychainSet');
        expect(prompt).toContain('keychainGet');
        expect(prompt).toContain('keychainDelete');
    });

    it('includes knowledge graph lifecycle guidance', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('buildKnowledgeGraph');
        expect(prompt).toContain('Build once at session start');
    });

    it('includes common workflows section', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Workflows & Patterns');
        expect(prompt).toContain('Safe Refactoring');
        expect(prompt).toContain('Pre-commit');
        expect(prompt).toContain('Debug');
    });

    it('includes model selection guidance', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Model Selection');
        expect(prompt).toContain('Fast/cheap');
        expect(prompt).toContain('Balanced');
        expect(prompt).toContain('Deep reasoning');
    });

    it('includes anti-patterns section', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        // Anti-patterns were consolidated into Workflows & Patterns and Error Recovery
        expect(prompt).toContain("don't use searchReplace for code symbols");
        expect(prompt).toContain("don't store secrets in memory");
    });

    it('includes tool combinations section', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        // Tool combinations were consolidated into Workflows & Patterns
        expect(prompt).toContain('Architecture');
        expect(prompt).toContain('buildKnowledgeGraph');
        expect(prompt).toContain('Pre-commit');
    });

    it('includes mode-specific tool guidance', () => {
        // Mode-specific guidance is now integrated into Tool Usage sections
        const buildPrompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(buildPrompt).toContain('Every Task');
        expect(buildPrompt).toContain('Most Tasks');
        expect(buildPrompt).toContain('Common Tools');

        const planPrompt = buildSystemPrompt({ mode: 'PLAN' });
        expect(planPrompt).toContain('Tool Usage');
    });

    it('includes additional workflow patterns', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Feature');
        expect(prompt).toContain('Rename Across Files');
        expect(prompt).toContain('New File');
        expect(prompt).toContain('Code Review');
    });

    it('includes Quick Reference at top of prompt', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Quick Reference');
        expect(prompt).toContain('Read before edit');
        expect(prompt).toContain('Parallelize');
        expect(prompt).toContain('Verify after changes');
    });

    it('includes Happy Path example', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Happy Path');
        expect(prompt).toContain('good path');
        expect(prompt).toContain('bad path');
    });

    it('does not include Quick Reference for subagents', () => {
        const prompt = buildSubagentSystemPrompt({ mode: 'BUILD' });
        expect(prompt).not.toContain('Quick Reference');
    });

    it('includes Error Recovery section', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Error Recovery');
        expect(prompt).toContain('validateCode fails');
        expect(prompt).toContain('editFile fails');
        expect(prompt).toContain('bash command fails');
    });

    it('resolves grep vs semanticSearch correctly', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        // grep for string literals, semanticSearch for symbols
        expect(prompt).toContain('Use grep for string literals');
        expect(prompt).toContain('semanticSearch');
        expect(prompt).toContain('NOT for string literals');
    });

    it('includes tool frequency organization', () => {
        const prompt = buildSystemPrompt({ mode: 'BUILD' });
        expect(prompt).toContain('Every Task');
        expect(prompt).toContain('Most Tasks');
        expect(prompt).toContain('Common Tools');
    });
});
