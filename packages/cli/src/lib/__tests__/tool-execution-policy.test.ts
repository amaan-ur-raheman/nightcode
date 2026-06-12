import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getToolExecutionPolicy,
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
    });

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
