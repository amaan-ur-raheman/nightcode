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
        expect(prompt).toContain('Batch tool calls in parallel');
        expect(prompt).toContain('GOOD:');
        expect(prompt).toContain('BAD:');
    });

    it('buildSubagentSystemPrompt includes mode-specific rules', () => {
        const planPrompt = buildSubagentSystemPrompt({ mode: 'PLAN' });
        expect(planPrompt).toContain('Present concrete findings');

        const buildPrompt = buildSubagentSystemPrompt({ mode: 'BUILD' });
        expect(buildPrompt).toContain('Verify changes');
    });
});
