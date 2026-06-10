import { describe, it, expect } from 'vitest';
import { optimizePrompt, estimateTokens } from '../prompt-optimizer';

describe('Prompt Optimization', () => {
    it('should reduce prompt size by removing filler phrases', () => {
        const original = 'You must always ensure that you please handle this carefully. Kindly remember to verify.';
        const optimized = optimizePrompt(original);
        expect(optimized.length).toBeLessThan(original.length);
        expect(optimized).not.toContain('please');
        expect(optimized).not.toContain('ensure that');
        expect(optimized).not.toContain('kindly');
        expect(optimized).not.toContain('remember to');
    });

    it('should compress excessive whitespace', () => {
        const original = 'Line one\n\n\n\n\nLine two';
        const optimized = optimizePrompt(original);
        expect(optimized).toBe('Line one\n\nLine two');
    });

    it('should not change meaning of core instructions', () => {
        const original = 'You must read the file before editing.';
        const optimized = optimizePrompt(original);
        expect(optimized).toBe('must read the file before editing.');
    });

    it('should estimate tokens correctly', () => {
        expect(estimateTokens('Hello world')).toBe(3); // 11 chars / 4 = 2.75 → 3
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('1234')).toBe(1);
        expect(estimateTokens('12345')).toBe(2);
    });
});
