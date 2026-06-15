/**
 * Prompt optimization utilities for reducing system prompt token usage.
 *
 * Compression techniques:
 * 1. Remove redundant filler phrases
 * 2. Consolidate repeated patterns
 * 3. Remove excessive whitespace
 * 4. Structural compression of repeated section patterns
 * 5. Deduplicate consecutive lines with same structure
 */

export function optimizePrompt(prompt: string): string {
    let result = prompt
        // Filler phrases
        .replace(/\bplease\b/gi, '')
        .replace(/\bkindly\b/gi, '')
        .replace(/\bensure that\b/gi, '')
        .replace(/\bmake sure to\b/gi, '')
        .replace(/\byou must\b/gi, 'must')
        .replace(/\bit is important that\b/gi, '')
        .replace(/\bremember to\b/gi, '')
        .replace(/\bdo not\b/gi, "don't")
        .replace(/\bdoes not\b/gi, "doesn't")
        .replace(/\bcannot\b/gi, "can't")
        .replace(/\bwill not\b/gi, "won't")
        // Structural compression: collapse repeated "When to X" patterns
        .replace(/\*\*When to (\w+)\*\*:?\s*/g, '**$1:** ')
        // Collapse markdown list items with long preambles
        .replace(/^- \*\*(\w+)\*\* — \*\*(.+?)\*\*\s*/gm, '- **$1** — ')
        // Collapse long consecutive bullet lists into compact form (6+ items)
        .replace(/(^- .+(\n|$)){6,}/gm, (match) => {
            const items = match.trim().split('\n');
            if (items.length < 6) return match;
            // Keep first 5 items, collapse rest into a single summary line
            const kept = items.slice(0, 5).join('\n');
            const collapsed = items.slice(5).length;
            return `${kept}\n- ...and ${collapsed} more similar items\n`;
        })
        // Whitespace normalization
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[^\S\n]{2,}/g, ' ')
        .trim();

    // Remove trailing periods from bullet items (saves tokens)
    result = result.replace(/^(- .+)\.$/gm, '$1');

    return result;
}

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
