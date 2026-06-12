/**
 * Prompt optimization utilities for reducing system prompt token usage.
 *
 * Compression techniques:
 * 1. Remove redundant filler phrases
 * 2. Consolidate repeated patterns
 * 3. Remove excessive whitespace
 * 4. Deduplicate consecutive lines with same structure
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
