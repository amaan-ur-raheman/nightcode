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
        expect(tracker.record('error: PREFIXENOENT occurred')).not.toContain(
            'does not exist',
        );

        // Should NOT contain the ENOENT-specific suggestion
        const suggestions = tracker.getSuggestions();
        expect(suggestions.some((s) => s.includes('does not exist'))).toBe(
            false,
        );
    });

    it('learns new patterns from repeated unknown errors', () => {
        const tracker = new ErrorPatternTracker();

        // First two occurrences — below threshold
        expect(tracker.record('Some completely unknown error')).toBeNull();
        expect(tracker.record('Some completely unknown error')).toBeNull();

        // Third occurrence — triggers learning
        const suggestion = tracker.record('Some completely unknown error');
        expect(suggestion).not.toBeNull();
        expect(suggestion).toContain('Repeated error');

        // Should have a learned suggestion
        expect(tracker.getSuggestions()).toHaveLength(1);
    });

    it('marks resolved patterns as suppressed', () => {
        const tracker = new ErrorPatternTracker();

        // Trigger a pattern
        tracker.record('ENOENT: file missing');
        tracker.record('ENOENT: file missing');
        tracker.record('ENOENT: file missing');
        expect(tracker.getSuggestions()).toHaveLength(1);

        // Resolve it
        tracker.markResolved('ENOENT');
        expect(tracker.getSuggestions()).toHaveLength(0);

        // Should not re-trigger after resolution
        expect(tracker.record('ENOENT: file missing')).toBeNull();
    });
});
