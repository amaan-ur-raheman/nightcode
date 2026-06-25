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
                    'read_file',
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
                makeToolResult('write_file', `wrote file ${i}`, {
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

    it('anchor extracts decision reasoning chains', () => {
        const msgs = [
            makeTextMsg('user', 'Start'),
            makeTextMsg(
                'assistant',
                'I decided to refactor this file because it was too complex.',
            ),
            makeTextMsg(
                'assistant',
                'First, we will initialize the workspace. Then, we will create the DB entries. Finally, we will test it.',
            ),
            makeTextMsg('assistant', 'The goal is to increase coverage.'),
            ...Array.from({ length: 30 }, (_, i) =>
                makeTextMsg('assistant', `Filler msg ${i}`),
            ),
        ];

        const result = compressContext(msgs, { tier1Count: 4, tier2Count: 4 });
        expect(result.anchor).toContain('Reasoning chain');
        expect(result.anchor).toContain('Key decisions');
        expect(result.anchor).toContain('I decided to refactor');
        expect(result.anchor).toContain('First, we will initialize');
        expect(result.anchor).toContain('increase coverage');
    });

    it('ProgressiveContextLoader loads context in batches', async () => {
        const { ProgressiveContextLoader } =
            await import('../context-compression');
        const msgs = Array.from({ length: 25 }, (_, i) =>
            makeTextMsg('assistant', `Message ${i}`),
        );
        const loader = new ProgressiveContextLoader(msgs);

        const batch1 = loader.getNextBatch(10);
        expect(batch1.messages.length).toBe(10);
        expect(batch1.hasMore).toBe(true);
        expect(batch1.messages[0].parts[0].text).toBe('Message 15');

        const batch2 = loader.getNextBatch(10);
        expect(batch2.messages.length).toBe(10);
        expect(batch2.hasMore).toBe(true);

        const batch3 = loader.getNextBatch(10);
        expect(batch3.messages.length).toBe(5);
        expect(batch3.hasMore).toBe(false);
    });

    it('does not classify read-only git_operation and run_command as write tools', () => {
        const msgs = [
            makeTextMsg('user', 'Start'),
            makeToolResult('git_operation', 'status output', {
                action: 'status',
                path: '/src/ignored-status.ts',
            }),
            makeToolResult('git_operation', 'diff output', {
                action: 'diff',
                path: '/src/ignored-diff.ts',
            }),
            makeToolResult('git_operation', 'log output', {
                action: 'log',
                path: '/src/ignored-log.ts',
            }),
            makeToolResult('run_command', 'token output', {
                action: 'token_count',
                path: '/src/ignored-tokens.ts',
            }),
            // True write operations
            makeToolResult('git_operation', 'commit output', {
                action: 'commit',
                path: '/src/committed-file.ts',
            }),
            makeToolResult('run_command', 'bash output', {
                action: 'bash',
                path: '/src/bash-modified-file.ts',
            }),
            // Filler to push everything above into tier 3
            ...Array.from({ length: 10 }, (_, i) =>
                makeTextMsg('assistant', `Filler ${i}`),
            ),
        ];

        const result = compressContext(msgs, { tier1Count: 5, tier2Count: 5 });

        expect(result.anchor).toContain(
            'Files modified: /src/committed-file.ts, /src/bash-modified-file.ts',
        );
        expect(result.anchor).not.toContain('ignored-status.ts');
        expect(result.anchor).not.toContain('ignored-diff.ts');
        expect(result.anchor).not.toContain('ignored-log.ts');
        expect(result.anchor).not.toContain('ignored-tokens.ts');
    });
});
