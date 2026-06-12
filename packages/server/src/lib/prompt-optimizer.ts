/**
 * Prompt optimization utilities for reducing system prompt token usage.
 *
 * Compression techniques:
 * 1. Remove redundant filler phrases
 * 2. Consolidate repeated patterns
 * 3. Remove excessive whitespace
 * 4. Context-aware conditional sections (only include what's needed)
 */

export function optimizePrompt(prompt: string): string {
    return prompt
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\bplease\b/gi, '')
        .replace(/\bkindly\b/gi, '')
        .replace(/\bensure that\b/gi, '')
        .replace(/\bmake sure to\b/gi, '')
        .replace(/\byou must\b/gi, 'must')
        .replace(/\bit is important that\b/gi, '')
        .replace(/\bremember to\b/gi, '')
        .replace(/[^\S\n]{2,}/g, ' ')
        .trim();
}

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export interface ContextOptions {
    hasMcpServers?: boolean;
    hasMemory?: boolean;
    isBuildMode?: boolean;
    isSubagent?: boolean;
    projectType?: string;
}

export function buildContextualSections(ctx: ContextOptions): string[] {
    const sections: string[] = [];

    if (ctx.isBuildMode) {
        sections.push(
            `## Spawning Subagents`,
            `Use **spawnAgent** for independent, parallelizable tasks.`,
            `- Provide a self-contained prompt with all context (file paths, code, targets). The subagent has no access to your history.`,
            `- Mode: Set to BUILD for changes, PLAN for read-only.`,
            `- Integrate results after the subagent completes.`,
        );
    } else if (!ctx.isSubagent) {
        sections.push(
            `## Spawning Subagents`,
            `Use **spawnAgent** for self-contained research/analysis tasks.`,
            `- Provide a self-contained prompt with all context.`,
            `- You are in PLAN mode — subagent must also be PLAN.`,
        );
    }

    return sections;
}
