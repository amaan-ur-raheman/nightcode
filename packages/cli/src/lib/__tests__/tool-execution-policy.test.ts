import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getToolExecutionPolicy,
    getModelTimeoutMultiplier,
    runWithToolExecutionPolicy,
    ToolExecutionTimeoutError,
} from '../tool-execution-policy';

describe('tool execution policy', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses command timeout input plus grace for bash', () => {
        expect(getToolExecutionPolicy('bash', { timeout: 1234 })).toMatchObject(
            {
                timeoutMs: 3234,
                longRunning: true,
            },
        );
    });

    it('uses short timeouts for fast read-only tools', () => {
        expect(getToolExecutionPolicy('readFile')).toMatchObject({
            timeoutMs: 20_000,
            longRunning: false,
        });
    });

    it('uses long timeouts and behavior for reviewPr', () => {
        expect(getToolExecutionPolicy('reviewPr')).toMatchObject({
            timeoutMs: 600_000,
            longRunning: true,
        });
    });

    it('fails hung tools on the outer deadline even if they ignore abort', async () => {
        vi.useFakeTimers();

        const promise = runWithToolExecutionPolicy(
            'readFile',
            {},
            undefined,
            () => new Promise(() => {}),
        );
        const assertion = expect(promise).rejects.toBeInstanceOf(
            ToolExecutionTimeoutError,
        );

        await vi.advanceTimersByTimeAsync(20_000);

        await assertion;
    }, 10_000);

    it('forwards parent aborts to the running tool', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        let receivedSignal: AbortSignal | undefined;

        const promise = runWithToolExecutionPolicy(
            'grep',
            {},
            controller.signal,
            (signal) => {
                receivedSignal = signal;
                return new Promise(() => {});
            },
        );
        const assertion = expect(promise).rejects.toMatchObject({
            name: 'AbortError',
        });

        controller.abort();
        await vi.advanceTimersByTimeAsync(0);

        expect(receivedSignal?.aborted).toBe(true);
        await assertion;
    });
});

describe('model-aware timeout multipliers', () => {
    it('returns 1.5x for slow reasoning models (claude-opus-4)', () => {
        expect(getModelTimeoutMultiplier('claude-opus-4')).toBe(1.5);
    });

    it('returns 1.5x for o3', () => {
        expect(getModelTimeoutMultiplier('o3')).toBe(1.5);
    });

    it('returns 1.25x for standard models (gpt-4o)', () => {
        expect(getModelTimeoutMultiplier('gpt-4o')).toBe(1.25);
    });

    it('returns 1.0x for fast models (gemini-2.0-flash)', () => {
        expect(getModelTimeoutMultiplier('gemini-2.0-flash')).toBe(1.0);
    });

    it('returns default multiplier for unknown models', () => {
        expect(getModelTimeoutMultiplier('some-unknown-model')).toBe(1.0);
    });

    it('returns default multiplier when no model specified', () => {
        expect(getModelTimeoutMultiplier()).toBe(1.0);
    });

    it('uses suffix matching for provider-prefixed models', () => {
        expect(getModelTimeoutMultiplier('openai/gpt-4o')).toBe(1.25);
        expect(getModelTimeoutMultiplier('anthropic/claude-opus-4')).toBe(1.5);
        expect(getModelTimeoutMultiplier('google/gemini-2.0-flash')).toBe(1.0);
    });

    it('applies model multiplier to tool timeouts', () => {
        // readFile with claude-opus-4: 20_000 * 1.5 = 30_000
        expect(
            getToolExecutionPolicy('readFile', undefined, 'claude-opus-4'),
        ).toMatchObject({
            timeoutMs: 30_000,
            longRunning: false,
        });
    });

    it('caps multiplier at 2.25x', () => {
        // Even if we hypothetically had a 3x model, it would be capped
        expect(getModelTimeoutMultiplier('claude-opus-4')).toBeLessThanOrEqual(
            2.25,
        );
    });
});
