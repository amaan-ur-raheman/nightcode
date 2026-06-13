import { randomUUID } from 'crypto';
import { type ModeType } from '@nightcode/shared';
import { debug } from './debug';

interface BatchedRequest {
    id: string;
    tool: string;
    input: unknown;
    mode: ModeType;
    model?: string;
    signal?: AbortSignal;
    execId?: string;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}

export interface BatchConfig {
    maxBatchSize: number;
    maxWaitTime: number;
    enabledTools: string[];
    parallelExecutionEnabled: boolean;
    maxParallelTools: number;
}

export interface ParallelToolCall {
    toolName: string;
    input: unknown;
    toolCallId: string;
    signal?: AbortSignal;
}

export interface ParallelToolResult {
    toolCallId: string;
    result: unknown;
    error?: Error;
}

const DEFAULT_BATCH_TOOLS = [
    'readFile',
    'listDirectory',
    'glob',
    'grep',
    'codeSearch',
    'tree',
    'fileInfo',
];

const ALL_PARALLEL_TOOLS = [
    ...DEFAULT_BATCH_TOOLS,
    'writeFile',
    'editFile',
    'bash',
    'patch',
    'searchReplace',
    'deleteFile',
    'moveFile',
    'createDirectory',
    'createFile',
    'gitStatus',
    'gitDiff',
    'gitCommit',
    'gitBranch',
    'gitLog',
    'gitBlame',
    'gitStatusExtended',
    'webFetch',
    'httpRequest',
    'getOutline',
    'diffFiles',
    'runTests',
    'processManage',
    'envManage',
    'secretScan',
    'memorySet',
    'memoryGet',
    'memoryDelete',
    'memoryList',
    'memorySearch',
    'keychainSet',
    'keychainGet',
    'keychainDelete',
    'tokenCount',
    'undo',
    'renameSymbol',
    'buildKnowledgeGraph',
    'queryKnowledgeGraph',
    'getKnowledgeNeighbors',
    'addKnowledgeNode',
    'addKnowledgeEdge',
    'detectKnowledgeCycles',
    'getKnowledgeStats',
    'impactAnalysis',
    'breakingChangeCheck',
    'suggestMigration',
];

const DEFAULT_CONFIG: BatchConfig = {
    maxBatchSize: 10,
    maxWaitTime: 50,
    enabledTools: DEFAULT_BATCH_TOOLS,
    parallelExecutionEnabled: true,
    maxParallelTools: 8,
};

class BatchManager {
    private queue: BatchedRequest[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private config: BatchConfig = { ...DEFAULT_CONFIG };
    private pendingFlush = 0;

    async addRequest(
        tool: string,
        input: unknown,
        executor: (
            tool: string,
            input: unknown,
            mode: ModeType,
            model?: string,
            signal?: AbortSignal,
            execId?: string,
        ) => Promise<unknown>,
        mode: ModeType,
        model?: string,
        signal?: AbortSignal,
        execId?: string,
    ): Promise<unknown> {
        if (!this.config.enabledTools.includes(tool)) {
            return executor(tool, input, mode, model, signal, execId);
        }

        return new Promise((resolve, reject) => {
            const request: BatchedRequest = {
                id: randomUUID(),
                tool,
                input,
                mode,
                model,
                signal,
                execId,
                resolve,
                reject,
            };

            this.queue.push(request);
            this.pendingFlush++;

            debug.log(
                'batch',
                `Queued ${tool} (queue size: ${this.queue.length})`,
            );

            if (!this.timer) {
                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.flush(executor).catch((err) => {
                        debug.log(
                            'batch',
                            `Timer flush failed: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    });
                }, this.config.maxWaitTime);
            }

            if (this.queue.length >= this.config.maxBatchSize) {
                if (this.timer) {
                    clearTimeout(this.timer);
                    this.timer = null;
                }
                this.flush(executor).catch((err) => {
                    debug.log(
                        'batch',
                        `Batch flush failed: ${err instanceof Error ? err.message : String(err)}`,
                    );
                });
            }
        });
    }

    private async flush(
        executor: (
            tool: string,
            input: unknown,
            mode: ModeType,
            model?: string,
            signal?: AbortSignal,
            execId?: string,
        ) => Promise<unknown>,
    ): Promise<void> {
        if (this.queue.length === 0) return;

        const batch = [...this.queue];
        this.queue = [];

        debug.log('batch', `Flushing ${batch.length} batched requests`);

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
        executor: (
            tool: string,
            input: unknown,
            mode: ModeType,
            model?: string,
            signal?: AbortSignal,
            execId?: string,
        ) => Promise<unknown>,
    ): Promise<void> {
        debug.log(
            'batch',
            `Executing ${requests.length} ${tool} requests in parallel`,
        );

        const results = await Promise.allSettled(
            requests.map((req) =>
                executor(
                    tool,
                    req.input,
                    req.mode,
                    req.model,
                    req.signal,
                    req.execId,
                ),
            ),
        );

        for (let i = 0; i < requests.length; i++) {
            const result = results[i];
            const req = requests[i];
            if (!result || !req) continue;

            if (result.status === 'fulfilled') {
                req.resolve(result.value);
            } else {
                req.reject(
                    result.reason instanceof Error
                        ? result.reason
                        : new Error(String(result.reason)),
                );
            }
        }
    }

    /**
     * Execute multiple tool calls in parallel.
     * Used by the chat hook when the LLM returns multiple tool calls in a single response.
     */
    async executeParallel(
        toolCalls: ParallelToolCall[],
        executor: (
            tool: string,
            input: unknown,
            mode: ModeType,
            model?: string,
            signal?: AbortSignal,
            toolCallId?: string,
        ) => Promise<unknown>,
        mode: ModeType,
        model?: string,
        signal?: AbortSignal,
        onSettled?: (result: ParallelToolResult) => void,
    ): Promise<ParallelToolResult[]> {
        if (toolCalls.length === 0) return [];

        const capped = toolCalls.slice(0, this.config.maxParallelTools);
        const skipped = toolCalls.slice(this.config.maxParallelTools);
        if (skipped.length > 0) {
            debug.log(
                'batch',
                `Capping parallel execution from ${toolCalls.length} to ${this.config.maxParallelTools}`,
            );
        }

        debug.log(
            'batch',
            `Executing ${capped.length} tools in parallel: ${capped.map((t) => t.toolName).join(', ')}`,
        );

        const notifySettled = (result: ParallelToolResult) => {
            try {
                onSettled?.(result);
            } catch (error) {
                debug.log(
                    'batch',
                    `Parallel settle callback failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        };

        const promises = capped.map(async (tc): Promise<ParallelToolResult> => {
            try {
                const result = await executor(
                    tc.toolName,
                    tc.input,
                    mode,
                    model,
                    tc.signal ?? signal,
                    tc.toolCallId,
                );
                const settled = { toolCallId: tc.toolCallId, result };
                notifySettled(settled);
                return settled;
            } catch (reason) {
                const settled = {
                    toolCallId: tc.toolCallId,
                    result: undefined,
                    error:
                        reason instanceof Error
                            ? reason
                            : new Error(String(reason)),
                };
                notifySettled(settled);
                return settled;
            }
        });

        const skippedResults: ParallelToolResult[] = skipped.map((tc) => ({
            toolCallId: tc.toolCallId,
            result: undefined,
            error: new Error(
                `Tool execution skipped: parallel limit of ${this.config.maxParallelTools} reached`,
            ),
        }));

        return Promise.all([...promises, ...skippedResults]);
    }

    getConfig(): Readonly<BatchConfig> {
        return this.config;
    }

    updateConfig(config: Partial<BatchConfig>): void {
        this.config = { ...this.config, ...config };
        debug.log('batch', 'Config updated', this.config);
    }

    toggle(): boolean {
        if (this.config.enabledTools.length > 0) {
            this.config = {
                ...this.config,
                enabledTools: [],
                parallelExecutionEnabled: false,
            };
        } else {
            this.config = {
                ...this.config,
                enabledTools: DEFAULT_BATCH_TOOLS,
                parallelExecutionEnabled: true,
            };
        }
        debug.log(
            'batch',
            `Batching ${this.config.enabledTools.length > 0 ? 'enabled' : 'disabled'}`,
        );
        return this.config.enabledTools.length > 0;
    }

    getStats() {
        return {
            queueSize: this.queue.length,
            pendingFlush: this.pendingFlush,
            enabled: this.config.enabledTools.length > 0,
            parallelExecution: this.config.parallelExecutionEnabled,
            maxParallelTools: this.config.maxParallelTools,
        };
    }

    resetStats(): void {
        this.pendingFlush = 0;
    }
}

export const batchManager = new BatchManager();
