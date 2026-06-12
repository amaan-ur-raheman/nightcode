import { describe, it, expect } from 'vitest';
import { optimizePrompt, estimateTokens } from '../prompt-optimizer';

describe('optimizePrompt', () => {
    it('removes redundant newlines', () => {
        const result = optimizePrompt('line1\n\n\n\n\nline2');
        expect(result).toBe('line1\n\nline2');
    });

    it('removes filler words like "please"', () => {
        const result = optimizePrompt('Please write clean code');
        expect(result).toBe('write clean code');
    });

    it('removes "kindly"', () => {
        const result = optimizePrompt('Kindly check this');
        expect(result).toBe('check this');
    });

    it('removes "ensure that"', () => {
        const result = optimizePrompt('Ensure that the tests pass');
        expect(result).toBe('the tests pass');
    });

    it('removes "make sure to"', () => {
        const result = optimizePrompt('Make sure to commit');
        expect(result).toBe('commit');
    });

    it('replaces "you must" with "must"', () => {
        const result = optimizePrompt('You must follow the rules');
        expect(result).toBe('must follow the rules');
    });

    it('removes "it is important that"', () => {
        const result = optimizePrompt('It is important that you test');
        expect(result).toBe('you test');
    });

    it('removes "remember to"', () => {
        const result = optimizePrompt('Remember to save the file');
        expect(result).toBe('save the file');
    });

    it('collapses multiple spaces', () => {
        const result = optimizePrompt('hello    world   test');
        expect(result).toBe('hello world test');
    });

    it('trims the result', () => {
        const result = optimizePrompt('  hello  ');
        expect(result).toBe('hello');
    });

    it('handles case-insensitive matching', () => {
        const result = optimizePrompt('PLEASE ensure that you must test');
        expect(result).toBe('must test');
    });
});

describe('estimateTokens', () => {
    it('estimates tokens as ceil(length / 4)', () => {
        expect(estimateTokens('1234')).toBe(1);
        expect(estimateTokens('12345')).toBe(2);
        expect(estimateTokens('hello world')).toBe(3);
    });

    it('returns 0 for empty string', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('returns correct count for longer text', () => {
        const text = 'a'.repeat(100);
        expect(estimateTokens(text)).toBe(25);
    });
});
