import { describe, it, expect } from 'vitest';
import { declareConfidenceTool } from '../declare-confidence';

describe('declareConfidenceTool', () => {
    it('handles high confidence declaration', async () => {
        const result = await declareConfidenceTool({
            confidence: 'high',
            reasoning: 'Changes are straightforward and verified locally.',
        });
        expect(result.status).toBe('declared');
        expect(result.confidence).toBe('high');
        expect(result.verificationRequired).toBe(false);
        expect(result.harnessResponse).toContain('standard execution');
    });

    it('handles low confidence declaration', async () => {
        const result = await declareConfidenceTool({
            confidence: 'low',
            reasoning:
                'I am not completely sure about the syntax in this legacy file.',
        });
        expect(result.status).toBe('declared');
        expect(result.confidence).toBe('low');
        expect(result.verificationRequired).toBe(true);
        expect(result.harnessResponse).toContain(
            'Extra verification will be injected',
        );
    });
});
