import { describe, it, expect } from 'vitest';
import { ErrorPatternTracker } from '../error-pattern-tracker';

describe('ErrorPatternTracker', () => {
    it('returns null for empty/whitespace errors', () => {
        const tracker = new ErrorPatternTracker();
        expect(tracker.record('')).toBeNull();
        expect(tracker.record('   ')).toBeNull();
        expect(tracker.record('\n\t')).toBeNull();
    });

    it('matches keywords case-insensitively with word boundaries', () => {
        const tracker = new ErrorPatternTracker();

        // ENOENT matches
        // We need 3 errors to get a suggestion
        expect(tracker.record('error: ENOENT occurred')).toBeNull();
        expect(tracker.record('error: enoent occurred')).toBeNull();
        const suggestion = tracker.record('error: Enoent occurred');
        expect(suggestion).not.toBeNull();
        expect(suggestion).toContain('does not exist');
    });

    it('avoids substring false-positives by using word boundaries', () => {
        const tracker = new ErrorPatternTracker();

        // "PREFIXENOENT" does not match "ENOENT" because of lack of word boundary
        expect(tracker.record('error: PREFIXENOENT occurred')).toBeNull();
        expect(tracker.record('error: PREFIXENOENT occurred')).toBeNull();
        expect(tracker.record('error: PREFIXENOENT occurred')).toBeNull();

        // Ensure no suggestion was generated because it was not matched as ENOENT
        expect(tracker.getSuggestions()).toHaveLength(0);
    });

    it('returns null for generic unmatched errors', () => {
        const tracker = new ErrorPatternTracker();

        expect(tracker.record('Some completely unknown error')).toBeNull();
        expect(tracker.record('Some completely unknown error')).toBeNull();
        expect(tracker.record('Some completely unknown error')).toBeNull();

        // No suggestion is returned because generic pattern slice fallback is removed
        expect(tracker.getSuggestions()).toHaveLength(0);
    });
});
