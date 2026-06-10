import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestQueue } from "../request-queue";

describe("RequestQueue priority order on retry", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        requestQueue.clear();
        requestQueue.updateConfig({ maxConcurrent: 1, retryDelay: 10 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("ensures that retried requests respect priority sorting rather than just being unshifted to the front", async () => {
        const executions: string[] = [];

        // Request 1: runs first (priority 1) and will fail immediately with a retryable error
        let shouldFail = true;
        const req1Promise = requestQueue.enqueue(
            async () => {
                executions.push("req1");
                if (shouldFail) {
                    shouldFail = false;
                    throw new Error("timeout"); // retryable error
                }
                return "req1-success";
            },
            { priority: 1, maxRetries: 1 }
        );

        // Wait for request 1 to execute and fail
        await vi.advanceTimersByTimeAsync(0);

        // Enqueue Request 2 (priority 10) which runs next and takes 100ms
        let resolveReq2: (val: any) => void = () => {};
        const req2Promise = requestQueue.enqueue(
            () => new Promise((resolve) => {
                executions.push("req2");
                resolveReq2 = resolve;
            }),
            { priority: 10 }
        );

        // Enqueue Request 3 (priority 2) which remains in the queue
        const req3Promise = requestQueue.enqueue(
            async () => {
                executions.push("req3");
                return "req3-success";
            },
            { priority: 2 }
        );

        // Advance to start Request 2
        await vi.advanceTimersByTimeAsync(0);

        // Advance past the 10ms retry delay of Request 1
        // Request 1's retry timer fires and inserts it into the queue.
        // Queue status:
        // - Request 3 (priority 2)
        // - Request 1 (priority 1, retry)
        // Since we use insertAtPriority, queue order is [Req 3, Req 1].
        // If we used unshift, queue order would be [Req 1, Req 3].
        await vi.advanceTimersByTimeAsync(15);

        // Resolve Request 2 to allow the next queue items to process
        resolveReq2("req2-success");
        await req2Promise;

        // Advance timers to let the rest of the queue process
        await vi.advanceTimersByTimeAsync(0);

        // Wait for all requests to finish
        await Promise.all([req1Promise, req3Promise]);

        // Executions:
        // 1. req1 (first attempt - fails)
        // 2. req2 (priority 10 - starts and runs)
        // 3. req3 (priority 2 - runs next because priority 2 > priority 1)
        // 4. req1 (retry, priority 1 - runs last)
        expect(executions).toEqual(["req1", "req2", "req3", "req1"]);
    });
});
