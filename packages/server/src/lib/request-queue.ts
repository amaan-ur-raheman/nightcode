import { randomUUID } from "crypto";
import { serverDebug } from "./debug";

interface QueuedRequest {
    id: string;
    execute: () => Promise<any>;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    priority: number;
    createdAt: number;
    retries: number;
    maxRetries: number;
}

export interface QueueConfig {
    maxConcurrent: number;
    maxQueueSize: number;
    retryDelay: number;
    maxRetries: number;
    timeout: number;
}

const DEFAULT_CONFIG: QueueConfig = {
    maxConcurrent: 3,
    maxQueueSize: 100,
    retryDelay: 1000,
    maxRetries: 3,
    timeout: 30000,
};

export interface QueueStats {
    queueSize: number;
    running: number;
    rateLimited: boolean;
    rateLimitReset: number;
}

class RequestQueue {
    private queue: QueuedRequest[] = [];
    private running: Set<string> = new Set();
    private config: QueueConfig = { ...DEFAULT_CONFIG };
    private rateLimited = false;
    private rateLimitReset = 0;
    private statsListeners: Array<(stats: QueueStats) => void> = [];

    async enqueue<T>(
        execute: () => Promise<T>,
        options: { priority?: number; maxRetries?: number } = {},
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const request: QueuedRequest = {
                id: randomUUID(),
                execute: execute as () => Promise<any>,
                resolve: resolve as (result: any) => void,
                reject,
                priority: options.priority ?? 0,
                createdAt: Date.now(),
                retries: 0,
                maxRetries: options.maxRetries ?? this.config.maxRetries,
            };

            if (this.queue.length >= this.config.maxQueueSize) {
                reject(new Error("Request queue is full"));
                return;
            }

            if (this.rateLimited && Date.now() < this.rateLimitReset) {
                serverDebug.log("queue", `Request queued (rate limited until ${new Date(this.rateLimitReset).toISOString()})`);
            }

            this.queue.push(request);
            this.queue.sort((a, b) => b.priority - a.priority);

            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        while (this.running.size < this.config.maxConcurrent && this.queue.length > 0) {
            if (this.rateLimited && Date.now() < this.rateLimitReset) {
                const delay = this.rateLimitReset - Date.now();
                serverDebug.log("queue", `Waiting ${delay}ms for rate limit reset`);
                await this.sleep(delay);
                this.rateLimited = false;
            }

            const request = this.queue.shift();
            if (!request) break;

            this.executeRequest(request).catch((err) => {
                serverDebug.log("queue", `Unexpected error in request execution: ${(err as Error).message}`);
            });
        }

        this.emitStats();
    }

    private async executeRequest(request: QueuedRequest): Promise<void> {
        this.running.add(request.id);
        this.emitStats();

        try {
            const result = await Promise.race([
                request.execute(),
                this.timeoutPromise(this.config.timeout),
            ]);

            request.resolve(result);
            serverDebug.log("queue", `Request ${request.id} completed`);
        } catch (error) {
            const err = error as Error;

            if (this.isRateLimitError(err)) {
                const backoff = this.config.retryDelay * Math.pow(2, request.retries);
                this.rateLimited = true;
                this.rateLimitReset = Date.now() + backoff;
                serverDebug.log("queue", `Rate limited, queueing retry (backoff: ${backoff}ms)`);

                if (request.retries < request.maxRetries) {
                    request.retries++;
                    const delay = backoff;
                    setTimeout(() => {
                        this.queue.unshift(request);
                        this.processQueue();
                    }, delay);
                } else {
                    request.reject(err);
                }
            } else if (request.retries < request.maxRetries && this.isRetryableError(err)) {
                request.retries++;
                const delay = this.config.retryDelay * Math.pow(2, request.retries - 1);
                serverDebug.log("queue", `Retryable error, retrying (${request.retries}/${request.maxRetries})`);

                setTimeout(() => {
                    this.queue.unshift(request);
                    this.processQueue();
                }, delay);
            } else {
                request.reject(err);
            }
        } finally {
            this.running.delete(request.id);
            this.processQueue();
        }
    }

    private isRateLimitError(error: Error): boolean {
        const message = error.message.toLowerCase();
        return (
            message.includes("rate limit") ||
            message.includes("too many requests") ||
            message.includes("429")
        );
    }

    private isRetryableError(error: Error): boolean {
        const message = error.message.toLowerCase();
        return (
            message.includes("timeout") ||
            message.includes("network") ||
            message.includes("econnreset") ||
            message.includes("econnrefused")
        );
    }

    private timeoutPromise(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Request timeout")), ms);
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private emitStats(): void {
        const stats = this.getStats();
        for (const listener of this.statsListeners) {
            listener(stats);
        }
    }

    getStats(): QueueStats {
        return {
            queueSize: this.queue.length,
            running: this.running.size,
            rateLimited: this.rateLimited,
            rateLimitReset: this.rateLimitReset,
        };
    }

    onStatsChange(listener: (stats: QueueStats) => void): () => void {
        this.statsListeners.push(listener);
        return () => {
            this.statsListeners = this.statsListeners.filter((l) => l !== listener);
        };
    }

    updateConfig(config: Partial<QueueConfig>): void {
        this.config = { ...this.config, ...config };
        serverDebug.log("queue", "Config updated", this.config);
    }

    clear(): number {
        const cleared = this.queue.length;
        this.queue = [];
        this.emitStats();
        return cleared;
    }
}

export const requestQueue = new RequestQueue();
