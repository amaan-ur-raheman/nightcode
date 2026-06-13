import { describe, expect, it } from 'vitest';
import { compressContext } from '../context-compression';

function makeMessage(role: string, parts: any[]): any {
    return { id: crypto.randomUUID(), role, parts };
}

function makeTextMsg(role: string, text: string): any {
    return makeMessage(role, [{ type: 'text', text }]);
}

function makeToolResult(toolName: string, output: string, input?: any): any {
    return makeMessage('assistant', [
        {
            type: 'dynamic-tool',
            toolName,
            state: 'output-available',
            output,
            input: input ?? {},
        },
    ]);
}

function makeToolError(toolName: string, errorText: string): any {
    return makeMessage('assistant', [
        {
            type: 'dynamic-tool',
            toolName,
            state: 'output-error',
            errorText,
        },
    ]);
}

describe('context-compression', () => {
    it('returns messages unchanged when under tier threshold', () => {
        const msgs = Array.from({ length: 10 }, (_, i) =>
            makeTextMsg(i === 0 ? 'user' : 'assistant', `Message ${i}`),
        );
        const result = compressContext(msgs, { tier1Count: 8, tier2Count: 2 });

        // 10 messages <= tier1 + tier2 (8 + 2 = 10), so no compression needed
        expect(result.messages.length).toBe(10);
        expect(result.anchor).toBeNull();
        expect(result.stats.tokensSaved).toBe(0);
    });

    it('applies 3-tier compression to large message sets', () => {
        // Use longer messages so compression actually reduces token count
        const msgs = Array.from({ length: 50 }, (_, i) =>
            makeTextMsg(
                i === 0 ? 'user' : 'assistant',
                `Message ${i}: ${'x'.repeat(500)}`,
            ),
        );
        const result = compressContext(msgs, { tier1Count: 8, tier2Count: 12 });

        // Compression adds an anchor system message, so total may be original+1
        expect(result.messages.length).toBeLessThanOrEqual(msgs.length + 1);
        expect(result.stats.originalCount).toBe(50);
        expect(result.stats.tier1Count).toBeGreaterThan(0);
        expect(result.stats.tier2Count).toBe(12);
        expect(result.stats.tier3Count).toBeGreaterThan(0);
        expect(result.anchor).not.toBeNull();
        expect(result.stats.tokensSaved).toBeGreaterThan(0);
    });

    it('always preserves first user message', () => {
        const firstUser = makeTextMsg('user', 'Important first message');
        const msgs = [
            firstUser,
            ...Array.from({ length: 49 }, (_, i) =>
                makeTextMsg('assistant', `Msg ${i}`),
            ),
        ];
        const result = compressContext(msgs, { tier1Count: 8, tier2Count: 12 });

        // First real message (after optional anchor) should be the first user message
        const firstMsg = result.messages[0];
        if (firstMsg.role === 'system') {
            // Anchor is first, user message is second
            expect(result.messages[1].role).toBe('user');
        } else {
            expect(firstMsg.role).toBe('user');
        }
    });

    it('compresses tool outputs in Tier 2 but preserves errors', () => {
        const largeOutput = 'x'.repeat(5000);
        // Use large errors too so the comparison is fair
        const largeError =
            'Error: build failed\n' + '  at module.js:123\n'.repeat(300);

        const msgs = [
            makeTextMsg('user', 'Start'),
            // 14 old messages to push into tier2/tier3
            ...Array.from({ length: 14 }, (_, i) =>
                makeToolResult(
                    'readFile',
                    i % 2 === 0 ? largeOutput : largeError,
                ),
            ),
            // 8 recent messages (tier1)
            ...Array.from({ length: 8 }, (_, i) =>
                makeTextMsg('assistant', `Recent ${i}`),
            ),
        ];

        const result = compressContext(msgs, { tier1Count: 8, tier2Count: 6 });

        const toolParts = result.messages
            .filter((m: any) =>
                m.parts?.some((p: any) => p.type === 'dynamic-tool'),
            )
            .flatMap((m: any) =>
                m.parts.filter((p: any) => p.type === 'dynamic-tool'),
            );

        const errorParts = toolParts.filter((p: any) =>
            p.output?.toLowerCase().includes('error'),
        );
        const nonErrorParts = toolParts.filter(
            (p: any) => p.output && !p.output.toLowerCase().includes('error'),
        );

        expect(errorParts.length).toBeGreaterThan(0);
        expect(nonErrorParts.length).toBeGreaterThan(0);

        // Both should be compressed, but errors compressed less aggressively
        // Check compression ratio (compressed/original) for each type
        const avgErrorCompression =
            errorParts.reduce(
                (s, p) => s + p.output.length / largeError.length,
                0,
            ) / errorParts.length;
        const avgNonErrorCompression =
            nonErrorParts.reduce(
                (s, p) => s + p.output.length / largeOutput.length,
                0,
            ) / nonErrorParts.length;

        // Errors should retain a higher fraction of their original content
        expect(avgErrorCompression).toBeGreaterThan(avgNonErrorCompression);
    });

    it('anchor includes modified files', () => {
        const msgs = [
            makeTextMsg('user', 'Start'),
            ...Array.from({ length: 30 }, (_, i) =>
                makeToolResult('writeFile', `wrote file ${i}`, {
                    path: `/src/file${i}.ts`,
                }),
            ),
        ];

        const result = compressContext(msgs, { tier1Count: 8, tier2Count: 5 });
        expect(result.anchor).toContain('Files modified');
    });

    it('handles messages with no parts gracefully', () => {
        const msgs = [
            makeTextMsg('user', 'Start'),
            ...Array.from({ length: 30 }, () => ({
                id: crypto.randomUUID(),
                role: 'assistant',
                parts: [],
            })),
        ];

        const result = compressContext(msgs, { tier1Count: 8, tier2Count: 5 });
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.stats.originalCount).toBe(31);
    });

    it('preserves Tier 1 messages intact', () => {
        const tier1Texts = Array.from({ length: 8 }, (_, i) => `Tier1-${i}`);
        const msgs = [
            makeTextMsg('user', 'Start'),
            ...Array.from({ length: 25 }, (_, i) =>
                makeTextMsg('assistant', `Old-${i}`),
            ),
            ...tier1Texts.map((t) => makeTextMsg('assistant', t)),
        ];

        const result = compressContext(msgs, { tier1Count: 8, tier2Count: 5 });

        // The last 8 messages should be preserved exactly
        const lastMsgs = result.messages.slice(-8);
        for (let i = 0; i < 8; i++) {
            const text = lastMsgs[i]?.parts?.[0]?.text;
            expect(text).toBe(tier1Texts[i]);
        }
    });
});
