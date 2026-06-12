import { describe, it, expect } from 'vitest';
import { optimizePrompt, estimateTokens } from '../prompt-optimizer';

describe('Prompt Optimization', () => {
    it('should reduce prompt size by removing filler phrases', () => {
        const verbose =
            'Please ensure that you kindly check the configuration. Make sure to verify all settings. It is important that you run the tests.';
        const optimized = optimizePrompt(verbose);
        expect(optimized.length).toBeLessThan(verbose.length);
        expect(optimized).not.toContain('please');
        expect(optimized).not.toContain('kindly');
        expect(optimized).not.toContain('ensure that');
        expect(optimized).not.toContain('Make sure to');
        expect(optimized).not.toContain('It is important that');
    });

    it('should compress excessive whitespace', () => {
        const spaced = 'Line 1\n\n\n\n\nLine 2\n   \n  Line 3';
        const optimized = optimizePrompt(spaced);
        expect(optimized).not.toContain('\n\n\n');
    });

    it('should not change meaning of core instructions', () => {
        const instructions =
            'Run the test suite with coverage. Fix any failing tests.';
        const optimized = optimizePrompt(instructions);
        expect(optimized).toContain('Run the test suite');
        expect(optimized).toContain('Fix any failing');
    });

    it('should remove redundant whitespace between words', () => {
        const spaced = 'This   has   too   many   spaces.';
        const optimized = optimizePrompt(spaced);
        expect(optimized).toContain('This has too many');
        expect(optimized).not.toContain('   ');
    });

    it('should handle empty string', () => {
        expect(optimizePrompt('')).toBe('');
    });

    it('should estimate tokens correctly', () => {
        // estimateTokens uses Math.ceil(text.length / 4)
        expect(estimateTokens('hello')).toBe(2); // 5/4 = 1.25 → 2
        expect(estimateTokens('a')).toBe(1); // 1/4 = 0.25 → 1
        expect(estimateTokens('')).toBe(0); // 0/4 = 0 → 0
        // "hello world, this is a test!" has 28 chars: 28/4 = 7 → 7
        expect(estimateTokens('hello world, this is a test!')).toBe(7);
    });
});
