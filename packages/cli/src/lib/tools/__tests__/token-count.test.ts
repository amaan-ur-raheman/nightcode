import { describe, it, expect } from 'vitest';
import { tokenCountTool } from '../token-count';

describe('tokenCountTool', () => {
    it('returns token and word counts for text', async () => {
        const result = await tokenCountTool({ text: 'hello world test' });
        expect(result).toHaveProperty('tokenCount');
        expect(result).toHaveProperty('wordCount');
        expect(result).toHaveProperty('estimatedCost');
        expect(result.wordCount).toBe(3);
        expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('estimates higher token count for code-like text', async () => {
        const plainResult = await tokenCountTool({
            text: 'this is plain text about dogs',
        });
        const codeResult = await tokenCountTool({
            text: 'const x = function() { return 1; }',
        });
        // Code should have a higher token-to-word ratio due to 1.5x multiplier
        expect(codeResult.tokenCount).toBeGreaterThanOrEqual(
            plainResult.tokenCount,
        );
    });

    it('returns cost estimates', async () => {
        const result = await tokenCountTool({ text: 'hello' });
        expect(result.estimatedCost.input).toBeGreaterThanOrEqual(0);
        expect(result.estimatedCost.output).toBeGreaterThanOrEqual(0);
    });
});
