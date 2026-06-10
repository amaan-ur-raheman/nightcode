import { randomUUID } from "crypto";
import { type ModeType } from "@nightcode/shared";
import { debug } from "./debug";

interface BatchedRequest {
    id: string;
    tool: string;
    input: unknown;
    mode: ModeType;
    model?: string;
    signal?: AbortSignal;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}

export interface BatchConfig {
    maxBatchSize: number;
    maxWaitTime: number;
    enabledTools: string[];
}

const DEFAULT_CONFIG: BatchConfig = {
    maxBatchSize: 5,
    maxWaitTime: 100,
    enabledTools: ["readFile", "listDirectory", "glob", "grep", "codeSearch", "tree", "fileInfo"],
};

class BatchManager {
    private queue: BatchedRequest[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private config: BatchConfig = { ...DEFAULT_CONFIG };
    private pendingFlush = 0;

    async addRequest(
        tool: string,
        input: unknown,
        executor: (tool: string, input: unknown, mode: ModeType, model?: string, signal?: AbortSignal) => Promise<unknown>,
        mode: ModeType,
        model?: string,
        signal?: AbortSignal,
    ): Promise<unknown> {
        if (!this.config.enabledTools.includes(tool)) {
            return executor(tool, input, mode, model, signal);
        }

        return new Promise((resolve, reject) => {
            const request: BatchedRequest = {
                id: randomUUID(),
                tool,
                input,
                mode,
                model,
                signal,
                resolve,
                reject,
            };

            this.queue.push(request);
            this.pendingFlush++;

            debug.log("batch", `Queued ${tool} (queue size: ${this.queue.length})`);

            if (!this.timer) {
                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.flush(executor);
                }, this.config.maxWaitTime);
            }

            if (this.queue.length >= this.config.maxBatchSize) {
                if (this.timer) {
                    clearTimeout(this.timer);
                    this.timer = null;
                }
                this.flush(executor);
            }
        });
    }

    private async flush(
        executor: (tool: string, input: unknown, mode: ModeType, model?: string, signal?: AbortSignal) => Promise<unknown>,
    ): Promise<void> {
        if (this.queue.length === 0) return;

        const batch = [...this.queue];
        this.queue = [];

        debug.log("batch", `Flushing ${batch.length} batched requests`);

        const grouped = new Map<string, BatchedRequest[]>();
        for (const req of batch) {
            const group = grouped.get(req.tool);
            if (group) {
                group.push(req);
            } else {
                grouped.set(req.tool, [req]);
            }
        }

        const promises: Promise<void>[] = [];

        for (const [tool, requests] of grouped) {
            promises.push(this.executeGroup(tool, requests, executor));
        }

        await Promise.allSettled(promises);
    }

    private async executeGroup(
        tool: string,
        requests: BatchedRequest[],
        executor: (tool: string, input: unknown, mode: ModeType, model?: string, signal?: AbortSignal) => Promise<unknown>,
    ): Promise<void> {
        debug.log("batch", `Executing ${requests.length} ${tool} requests in parallel`);

        const results = await Promise.allSettled(
            requests.map((req) => executor(tool, req.input, req.mode, req.model, req.signal)),
        );

        for (let i = 0; i < requests.length; i++) {
            const result = results[i];
            const req = requests[i];
            if (!result || !req) continue;

            if (result.status === "fulfilled") {
                req.resolve(result.value);
            } else {
                req.reject(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
            }
        }
    }

    getConfig(): Readonly<BatchConfig> {
        return this.config;
    }

    updateConfig(config: Partial<BatchConfig>): void {
        this.config = { ...this.config, ...config };
        debug.log("batch", "Config updated", this.config);
    }

    toggle(): boolean {
        if (this.config.enabledTools.length > 0) {
            this.config = { ...this.config, enabledTools: [] };
        } else {
            this.config = { ...this.config, enabledTools: DEFAULT_CONFIG.enabledTools };
        }
        debug.log("batch", `Batching ${this.config.enabledTools.length > 0 ? "enabled" : "disabled"}`);
        return this.config.enabledTools.length > 0;
    }

    getStats() {
        return {
            queueSize: this.queue.length,
            pendingFlush: this.pendingFlush,
            enabled: this.config.enabledTools.length > 0,
        };
    }

    resetStats(): void {
        this.pendingFlush = 0;
    }
}

export const batchManager = new BatchManager();
