import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('generateSessionTitle', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('falls back to truncated message when GROQ_API_KEY is missing', async () => {
        delete process.env.GROQ_API_KEY;
        const { generateSessionTitle } =
            await import('../generate-session-title');
        const title = await generateSessionTitle(
            'Hello, this is a test message for my coding session',
        );
        expect(title).toBe(
            'Hello, this is a test message for my coding session',
        );
    });

    it('truncates long messages to 80 chars', async () => {
        delete process.env.GROQ_API_KEY;
        const { generateSessionTitle } =
            await import('../generate-session-title');
        const longMsg = 'a'.repeat(200);
        const title = await generateSessionTitle(longMsg);
        expect(title.length).toBeLessThanOrEqual(80);
    });

    it('handles empty message gracefully', async () => {
        delete process.env.GROQ_API_KEY;
        const { generateSessionTitle } =
            await import('../generate-session-title');
        const title = await generateSessionTitle('');
        expect(title).toBe('');
    });

    it('strips trailing whitespace from fallback', async () => {
        delete process.env.GROQ_API_KEY;
        const { generateSessionTitle } =
            await import('../generate-session-title');
        const title = await generateSessionTitle('   my title   ');
        expect(title).toBe('   my title');
    });

    it('uses Groq API when key is available', async () => {
        process.env.GROQ_API_KEY = 'test-key';
        vi.mock('@ai-sdk/groq', () => ({
            createGroq: () => () => ({}),
        }));
        vi.mock('ai', () => ({
            generateText: async () => ({ text: 'My Test Title' }),
        }));
        const { generateSessionTitle } =
            await import('../generate-session-title');
        const title = await generateSessionTitle(
            'Fix authentication bug in login flow',
        );
        expect(title).toBe('My Test Title');
    });
});
