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
    'read_file',
    'list_dir',
    'code_search',
    'workspace_memory',
    'manage_keychain',
    'knowledge_graph',
    'ask_question',
    'use_skill',
];

/**
 * Tools that modify files and need conflict detection.
 */
const FILE_WRITE_TOOLS = new Set(['write_file', 'edit_file']);

/**
 * Extract all target file paths from a tool call input.
 */
function getTargetFiles(toolName: string, input: unknown): string[] {
    if (!input || typeof input !== 'object') return [];
    const inp = input as Record<string, unknown>;

    const paths: string[] = [];

    if (toolName === 'edit_file' && inp.action === 'move') {
        const src =
            (inp.from as string) ??
            (inp.source as string) ??
            (inp.path as string);
        const dest =
            (inp.to as string) ??
            (inp.destPath as string) ??
            (inp.path as string);

        if (src) paths.push(src);
        if (dest && dest !== src) paths.push(dest);
    } else {
        const p = (inp.path as string) ?? null;
        if (p) paths.push(p);
    }

    return Array.from(new Set(paths.filter(Boolean)));
}

/**
 * Cost tier for each tool type used for adaptive parallel execution caps.
 * Reads/searches are cheap (high concurrency), writes are expensive (low concurrency).
 */
const TOOL_COST_TIERS: Record<string, 'low' | 'medium' | 'high'> = {
    // Low cost — fast, stateless reads
    read_file: 'low',
    list_dir: 'low',
    code_search: 'low',
    workspace_memory: 'low',
    manage_keychain: 'low',
    knowledge_graph: 'low',
    ask_question: 'low',
    use_skill: 'low',

    // Medium cost — git operations (read-only actions), orchestration status
    git_operation: 'medium',
    orchestrate_task: 'medium',

    // High cost — file mutations, command execution, agent spawning
    write_file: 'high',
    edit_file: 'high',
    run_command: 'high',
    spawn_agent: 'high',
};

/**
 * Get adaptive max parallel tools based on the mix of tool types in the current batch.
 * Uses a cost-weighted algorithm so that 8 read_file == 2 write_file in resource usage.
 */
function getAdaptiveParallelCap(toolCalls: ParallelToolCall[]): number {
    const tiers = toolCalls.map(
        (tc) => TOOL_COST_TIERS[tc.toolName] ?? 'medium',
    );

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

    const adaptiveCap = Math.max(
        MIN_CAP,
        Math.min(
            MAX_CAP,
            Math.floor(
                TARGET_WEIGHT / (weight / Math.max(toolCalls.length, 1)),
            ),
        ),
    );

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

        // Allowlist: only batch explicitly known read-only actions for
        // multi-action tools. Everything else executes immediately.
        const BATCHABLE_ACTIONS: Record<string, Set<string>> = {
            workspace_memory: new Set([
                'get',
                'list',
                'search',
                'fuzzy_search',
                'stats',
            ]),
            manage_keychain: new Set(['get']),
            knowledge_graph: new Set([
                'query',
                'neighbors',
                'detect_cycles',
                'stats',
                'impact',
                'breaking_check',
                'suggest_migration',
            ]),
        };
        const batchable = BATCHABLE_ACTIONS[tool];
        if (batchable) {
            const action =
                input && typeof input === 'object'
                    ? (input as Record<string, unknown>).action
                    : undefined;
            if (typeof action !== 'string' || !batchable.has(action)) {
                return executor(tool, input, mode, model, signal, execId);
            }
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

        // Detect file conflicts: group write tools by target files
        const writeCalls: ParallelToolCall[] = [];
        const nonConflictCalls: ParallelToolCall[] = [];

        for (const tc of capped) {
            if (FILE_WRITE_TOOLS.has(tc.toolName)) {
                const paths = getTargetFiles(tc.toolName, tc.input);
                if (paths.length > 0) {
                    writeCalls.push(tc);
                } else {
                    nonConflictCalls.push(tc);
                }
            } else {
                nonConflictCalls.push(tc);
            }
        }

        // Build connected components for write operations that share files
        const parent = Array.from({ length: writeCalls.length }, (_, i) => i);
        function find(i: number): number {
            let root = i;
            while (root !== parent[root]) {
                const p = parent[root];
                if (p === undefined) break;
                root = p;
            }
            let curr = i;
            while (curr !== root) {
                const next = parent[curr];
                if (next === undefined) break;
                parent[curr] = root;
                curr = next;
            }
            return root;
        }
        function union(i: number, j: number): void {
            const rootI = find(i);
            const rootJ = find(j);
            if (rootI !== rootJ) {
                parent[rootI] = rootJ;
            }
        }

        const pathToCallIndices = new Map<string, number[]>();
        for (let i = 0; i < writeCalls.length; i++) {
            const call = writeCalls[i];
            if (!call) continue;
            const paths = getTargetFiles(call.toolName, call.input);
            for (const path of paths) {
                let indices = pathToCallIndices.get(path);
                if (!indices) {
                    indices = [];
                    pathToCallIndices.set(path, indices);
                }
                indices.push(i);
            }
        }

        for (const [_, indices] of pathToCallIndices) {
            if (indices.length > 1) {
                const first = indices[0];
                if (first !== undefined) {
                    for (let k = 1; k < indices.length; k++) {
                        const nextIdx = indices[k];
                        if (nextIdx !== undefined) {
                            union(first, nextIdx);
                        }
                    }
                }
            }
        }

        const conflictGroups = new Map<number, ParallelToolCall[]>();
        for (let i = 0; i < writeCalls.length; i++) {
            const root = find(i);
            let comp = conflictGroups.get(root);
            if (!comp) {
                comp = [];
                conflictGroups.set(root, comp);
            }
            const call = writeCalls[i];
            if (call) {
                comp.push(call);
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

        // Execute conflicting calls sequentially per conflict group
        const sequentialPromises: Promise<ParallelToolResult[]>[] = [];
        for (const [_, conflicts] of conflictGroups) {
            const pathsTouched = Array.from(
                new Set(
                    conflicts.flatMap((tc) =>
                        getTargetFiles(tc.toolName, tc.input),
                    ),
                ),
            );
            const label = pathsTouched.join(', ');

            if (conflicts.length > 1) {
                debug.log(
                    'batch',
                    `Serializing ${conflicts.length} writes touching [${label}]`,
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
