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

/**
 * Tools that modify files and need conflict detection.
 */
const FILE_WRITE_TOOLS = new Set([
    'writeFile',
    'editFile',
    'searchReplace',
    'patch',
    'deleteFile',
    'moveFile',
]);

/**
 * Extract the target file path from a tool call input.
 */
function getTargetFile(toolName: string, input: unknown): string | null {
    if (!input || typeof input !== 'object') return null;
    const inp = input as Record<string, unknown>;

    if (toolName === 'moveFile') {
        // moveFile has both source and destination
        return (inp.to as string) ?? (inp.path as string) ?? null;
    }

    return (inp.path as string) ?? null;
}

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
    'gitStatus',
    'gitDiff',
    'gitCommit',
    'gitBranch',
    'gitLog',
    'gitBlame',
    'gitStatusExtended',
    'webFetch',
    'getOutline',
    'diffFiles',
    'processManage',
    'envManage',
    'secretScan',
    'memorySet',
    'memoryGet',
    'memoryDelete',
    'memoryList',
    'memorySearch',
    'memoryFuzzySearch',
    'memoryStats',
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
    'validateCode',
    'checkExternalChanges',
    'reviewPr',
    'semanticSearch',
    'profileCode',
];

/**
 * Cost tier for each tool type used for adaptive parallel execution caps.
 * Reads/searches are cheap (high concurrency), writes are expensive (low concurrency).
 */
const TOOL_COST_TIERS: Record<string, 'low' | 'medium' | 'high'> = {
    // Low cost — fast, stateless reads
    readFile: 'low',
    listDirectory: 'low',
    glob: 'low',
    grep: 'low',
    codeSearch: 'low',
    tree: 'low',
    fileInfo: 'low',
    getOutline: 'low',
    gitStatus: 'low',
    gitDiff: 'low',
    gitLog: 'low',
    gitBlame: 'low',
    gitStatusExtended: 'low',
    diffFiles: 'low',
    tokenCount: 'low',
    memoryGet: 'low',
    memoryList: 'low',
    memorySearch: 'low',
    memoryFuzzySearch: 'low',
    memoryStats: 'low',
    keychainGet: 'low',
    checkExternalChanges: 'low',
    queryKnowledgeGraph: 'low',
    getKnowledgeNeighbors: 'low',
    getKnowledgeStats: 'low',
    detectKnowledgeCycles: 'low',
    
    // Medium cost — mix of reads and state changes
    webFetch: 'medium',
    bash: 'medium',
    packageManager: 'medium',
    gitCommit: 'medium',
    gitBranch: 'medium',
    gitOperations: 'medium',
    memorySet: 'medium',
    memoryDelete: 'medium',
    keychainSet: 'medium',
    keychainDelete: 'medium',
    getTaskStatus: 'medium',
    buildKnowledgeGraph: 'medium',
    addKnowledgeNode: 'medium',
    addKnowledgeEdge: 'medium',
    impactAnalysis: 'medium',
    breakingChangeCheck: 'medium',
    suggestMigration: 'medium',
    semanticSearch: 'medium',
    profileCode: 'medium',
    askQuestion: 'medium',
    useSkill: 'medium',
    listSkills: 'medium',
    suggestTool: 'low',
    listToolCategories: 'low',
    declareConfidence: 'low',
    
    // High cost — file mutations, complex operations
    writeFile: 'high',
    editFile: 'high',
    searchReplace: 'high',
    patch: 'high',
    deleteFile: 'high',
    moveFile: 'high',
    createDirectory: 'high',
    renameSymbol: 'high',
    undo: 'high',
    processManage: 'high',
    envManage: 'high',
    secretScan: 'high',
    validateCode: 'high',
    reviewPr: 'high',
    spawnAgent: 'high',
    spawnCodeReviewer: 'high',
    spawnTestWriter: 'high',
    spawnDebugger: 'high',
    spawnRefactor: 'high',
    spawnResearcher: 'high',
    orchestrator: 'high',
    cancelTask: 'high',
    replExecute: 'high',
};

/**
 * Get adaptive max parallel tools based on the mix of tool types in the current batch.
 * Uses a cost-weighted algorithm so that 8 readFiles == 2 writeFiles in resource usage.
 */
function getAdaptiveParallelCap(toolCalls: ParallelToolCall[]): number {
    const tiers = toolCalls.map((tc) => TOOL_COST_TIERS[tc.toolName] ?? 'medium');
    
    let weight = 0;
    for (const tier of tiers) {
        switch (tier) {
            case 'low':
                weight += 1;
                break;
            case 'medium':
                weight += 3;
                break;
            case 'high':
                weight += 6;
                break;
        }
    }
    
    // Target total "weight" of ~24 (equivalent to 4 high-cost operations)
    const TARGET_WEIGHT = 24;
    const MIN_CAP = 2;
    const MAX_CAP = 16;
    
    const adaptiveCap = Math.max(MIN_CAP, Math.min(MAX_CAP, Math.floor(TARGET_WEIGHT / (weight / Math.max(toolCalls.length, 1)))));
    
    return adaptiveCap;
}

const DEFAULT_CONFIG: BatchConfig = {
    maxBatchSize: 10,
    maxWaitTime: 50,
    enabledTools: DEFAULT_BATCH_TOOLS,
    parallelExecutionEnabled: true,
    maxParallelTools: 8, // default, overridden adaptively
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

        // Use adaptive cap based on tool cost tiers instead of fixed maxParallelTools
        const effectiveCap = getAdaptiveParallelCap(toolCalls);
        const capped = toolCalls.slice(0, effectiveCap);
        const skipped = toolCalls.slice(effectiveCap);
        if (skipped.length > 0) {
            debug.log(
                'batch',
                `Capping parallel execution from ${toolCalls.length} to ${effectiveCap}`,
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

        // Detect file conflicts: group write tools by target file
        const fileConflictGroups = new Map<string, ParallelToolCall[]>();
        const nonConflictCalls: ParallelToolCall[] = [];

        for (const tc of capped) {
            if (FILE_WRITE_TOOLS.has(tc.toolName)) {
                const targetFile = getTargetFile(tc.toolName, tc.input);
                if (targetFile) {
                    const existing = fileConflictGroups.get(targetFile);
                    if (existing) {
                        existing.push(tc);
                    } else {
                        fileConflictGroups.set(targetFile, [tc]);
                    }
                } else {
                    nonConflictCalls.push(tc);
                }
            } else {
                nonConflictCalls.push(tc);
            }
        }

        // Execute non-conflicting calls in parallel
        const parallelPromises = nonConflictCalls.map(
            async (tc): Promise<ParallelToolResult> => {
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
            },
        );

        // Execute conflicting calls sequentially per file
        const sequentialPromises: Promise<ParallelToolResult[]>[] = [];
        for (const [file, conflicts] of fileConflictGroups) {
            if (conflicts.length > 1) {
                debug.log(
                    'batch',
                    `Serializing ${conflicts.length} writes to ${file}`,
                );
            }

            // Execute sequentially within each file group
            const sequentialPromise = (async (): Promise<
                ParallelToolResult[]
            > => {
                const results: ParallelToolResult[] = [];
                for (const tc of conflicts) {
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
                        results.push(settled);
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
                        results.push(settled);
                    }
                }
                return results;
            })();

            sequentialPromises.push(sequentialPromise);
        }

        const skippedResults: ParallelToolResult[] = skipped.map((tc) => ({
            toolCallId: tc.toolCallId,
            result: undefined,
            error: new Error(
                `Tool execution skipped: parallel limit of ${this.config.maxParallelTools} reached`,
            ),
        }));

        // Wait for all parallel and sequential groups to complete
        const [parallelResults, sequentialResults] = await Promise.all([
            Promise.all(parallelPromises),
            Promise.all(sequentialPromises),
        ]);

        return [
            ...parallelResults,
            ...sequentialResults.flat(),
            ...skippedResults,
        ];
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
