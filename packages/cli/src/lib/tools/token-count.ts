import { toolInputSchemas } from "@nightcode/shared";

/**
 * Rough token/cost estimates based on NIM pricing.
 * These are approximations — not exact tokenizer counts.
 */
const COST_PER_1K_INPUT_TOKENS = 0.0003;
const COST_PER_1K_OUTPUT_TOKENS = 0.0006;

function isLikelyCode(text: string): boolean {
    const codeIndicators = [
        /[{}\[\]();]/,
        /=>|===|!==|&&|\|\||\n\s{2,}/,
        /\b(const|let|var|function|return|import|export|class|if|else|for|while)\b/,
    ];
    let matches = 0;
    for (const re of codeIndicators) {
        if (re.test(text)) matches++;
    }
    return matches >= 2;
}

function estimateTokens(text: string): number {
    const words = text.split(/\s+/).filter(Boolean).length;
    const ratio = isLikelyCode(text) ? 1.5 : 1.3;
    return Math.ceil(words * ratio);
}

export async function tokenCountTool(input: unknown) {
    const { text } = toolInputSchemas.tokenCount.parse(input);

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const tokenCount = estimateTokens(text);

    return {
        tokenCount,
        wordCount,
        estimatedCost: {
            input: Number(((tokenCount / 1000) * COST_PER_1K_INPUT_TOKENS).toFixed(6)),
            output: Number(((tokenCount / 1000) * COST_PER_1K_OUTPUT_TOKENS).toFixed(6)),
        },
    };
}
