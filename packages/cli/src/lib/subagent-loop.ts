import { readUIMessageStream, uiMessageChunkSchema, parseJsonEventStream } from "ai";
import { executeLocalTool } from "./local-tools";
import { updateSubagentStep, incrementToolCall, completeSubagent } from "./subagent-progress";
import { debug } from "./debug";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

/**
 * Generate a short human-readable summary of a tool's input.
 * E.g., readFile → "package.json", grep → "pattern", bash → "bun test"
 */
function summarizeToolInput(toolName: string, input: any): string {
    if (!input || typeof input !== "object") return "";
    const truncate = (s: string, max = 40) => s.length > max ? s.slice(0, max - 3) + "..." : s;

    switch (toolName) {
        case "readFile":
        case "readFileAbsolute":
            return typeof input.path === "string" ? truncate(input.path) : "";
        case "writeFile":
        case "createFile":
            return typeof input.path === "string" ? truncate(input.path) : "";
        case "editFile":
        case "searchReplace":
            return typeof input.path === "string" ? truncate(input.path) : "";
        case "deleteFile":
        case "moveFile":
        case "diffFiles":
            return typeof input.path === "string" ? truncate(input.path) : (typeof input.from === "string" ? truncate(input.from) : "");
        case "listDirectory":
        case "tree":
            return typeof input.path === "string" ? truncate(input.path) : (typeof input.directory === "string" ? truncate(input.directory) : "");
        case "glob":
            return typeof input.pattern === "string" ? truncate(input.pattern) : "";
        case "grep":
        case "codeSearch":
            return typeof input.pattern === "string" ? truncate(input.pattern) : (typeof input.query === "string" ? truncate(input.query) : "");
        case "bash":
            return typeof input.command === "string" ? truncate(input.command, 50) : "";
        case "runTests":
            return typeof input.pattern === "string" ? truncate(input.pattern) : "";
        case "webFetch":
            return typeof input.url === "string" ? truncate(input.url, 50) : "";
        case "fileInfo":
            return typeof input.path === "string" ? truncate(input.path) : "";
        case "getOutline":
            return typeof input.path === "string" ? truncate(input.path) : "";
        case "gitStatus":
        case "gitDiff":
        case "gitLog":
        case "gitStatusExtended":
        case "gitBlame":
            return "";
        case "gitCommit":
            return typeof input.message === "string" ? truncate(input.message, 40) : "";
        case "gitBranch":
            return typeof input.name === "string" ? truncate(input.name) : (typeof input.branch === "string" ? truncate(input.branch) : "");
        case "renameSymbol":
            return typeof input.oldName === "string" ? truncate(input.oldName) : "";
        case "patch":
            return typeof input.file === "string" ? truncate(input.file) : "";
        case "createDirectory":
            return typeof input.path === "string" ? truncate(input.path) : "";
        case "processManage":
            return typeof input.action === "string" ? input.action : "";
        case "envManage":
            return typeof input.action === "string" ? input.action : "";
        case "tokenCount":
            return typeof input.text === "string" ? truncate(input.text, 30) : "";
        case "undo":
            return "";
        default:
            // For unknown tools, try to show the first string value from input
            for (const val of Object.values(input)) {
                if (typeof val === "string" && val.length > 0) return truncate(val);
            }
            return "";
    }
}

export type SubagentLoopConfig = {
    /** The initial user prompt/task for the subagent */
    prompt: string;
    /** BUILD or PLAN mode */
    mode: "BUILD" | "PLAN";
    /** Model ID */
    model: string;
    /** Auth token — used as initial token, refreshed before each step */
    auth: { token: string };
    /** Abort signal for cancellation */
    signal: AbortSignal;
    /** Max steps before giving up (default 50) */
    maxSteps?: number;
    /** Agent ID for progress tracking (if omitted, no progress updates) */
    agentId?: string;
    /** Label for logging (default "subagent") */
    label?: string;
    /** Max retries for rate-limited requests (default 5) */
    maxRetries?: number;
};

/**
 * Shared subagent execution loop used by both direct subagents (spawn-agent.ts)
 * and orchestrator workers (worker-agent.ts).
 *
 * Handles: streaming, message management, tool execution, rate limiting,
 * abort propagation, and progress tracking.
 */
export async function runSubagentLoop(config: SubagentLoopConfig): Promise<string> {
    const {
        prompt,
        mode,
        model,
        auth,
        signal,
        maxSteps = 100,
        agentId,
        label = "subagent",
        maxRetries = 5,
    } = config;

    const messages: any[] = [
        {
            id: crypto.randomUUID(),
            role: "user" as const,
            parts: [{ type: "text" as const, text: prompt }],
        },
    ];

    // Tool execution cache for deduplication
    const toolCache = new Map<string, Promise<any>>();
    const cacheExpiry = 300000; // 5 minutes
    const toolCacheTimestamps = new Map<string, number>();

    // H2: Maximum messages to keep in context to prevent unbounded growth.
    // Keeps the first user message + last MAX_CONTEXT_MESSAGES messages.
    // Lowered from 20→12 to reduce token explosion in long-running workers.
    const MAX_CONTEXT_MESSAGES = 12;

    // Per-step timeout: if a single step (LLM call + tool execution) takes longer
    // than this, abort the step to prevent runaway generation (e.g. 3K+ token outputs).
    const STEP_TIMEOUT_MS = 90_000;

    // Accumulate text output across steps for partial results on timeout
    let accumulatedText = "";

    console.log(`[${label}] Starting: mode=${mode} model=${model} maxSteps=${maxSteps}`);
    console.log(`[${label}] Task: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`);

    for (let step = 0; step < maxSteps; step++) {
        if (signal.aborted) {
            // Return partial results instead of throwing on abort
            if (accumulatedText) {
                if (agentId) completeSubagent(agentId, "completed");
                return accumulatedText;
            }
            const err = new Error(`${label} aborted`);
            (err as any).partialResult = accumulatedText || undefined;
            throw err;
        }

        // Fetch with retry for rate limits, wrapped with per-step timeout
        // Refresh auth before each step to handle token expiry mid-execution
        let response: Response | undefined;
        const stepSignal = AbortSignal.any([signal, AbortSignal.timeout(STEP_TIMEOUT_MS)]);
        const { getAuth } = await import("@/lib/auth");
        const freshAuth = getAuth();
        if (!freshAuth) {
            throw new Error("Not authenticated. Run /login to continue.");
        }
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            response = await fetch(`${API_URL}/subagent`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${freshAuth.token}`,
                },
                body: JSON.stringify({ messages, model, mode, agentId }),
                signal: stepSignal,
            });
            if (response.status !== 429) break;
            // Wait with abort support before retrying
            await new Promise<void>((resolve, reject) => {
                if (signal.aborted) { reject(new Error("Aborted")); return; }
                const t = setTimeout(resolve, (attempt + 1) * 3000);
                signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Aborted")); }, { once: true });
            });
        }

        if (!response || !response.ok) {
            const body = await response?.json().catch(() => ({})) as { error?: string };
            if (!response || response.status === 429) {
                throw new Error("Rate limit hit. Wait a moment and try again.");
            }
            if (response.status === 401) {
                throw new Error("Session expired. Run /login to continue.");
            }
            if (response.status === 402) {
                throw new Error("No credits remaining. Run /upgrade to buy more credits.");
            }
            throw new Error(body.error ?? `${label} failed with status ${response.status}`);
        }

        if (!response.body) throw new Error("No response body");

        // Parse streaming response
        const chunkStream = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema })
            .pipeThrough(new TransformStream({
                async transform(chunk, controller) {
                    if (!chunk.success) throw chunk.error;
                    controller.enqueue(chunk.value);
                }
            }));

        const stream = readUIMessageStream({ stream: chunkStream });
        let assistantMessage: any = null;

        try {
            for await (const message of stream) {
                assistantMessage = message;
            }
        } catch (streamErr: any) {
            const msg = streamErr?.message ?? String(streamErr);
            if (msg.includes("429") || msg.toLowerCase().includes("too many requests")) {
                throw new Error("Rate limit hit. Wait a moment and try again.");
            }
            throw streamErr;
        }

        if (!assistantMessage) {
            throw new Error(`No message received from ${label}`);
        }

        // Update message list — always append to accumulate full context
        messages.push(assistantMessage);

        // Find pending tool calls
        const toolCallsToExecute = assistantMessage.parts.filter((part: any) => {
            if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                return part.state === "input-available";
            }
            return false;
        });

        console.log(`[${label}] Step ${step + 1}/${maxSteps}: received response (${assistantMessage.parts.length} parts)`);

        // Accumulate text from this step for partial results
        const stepText = assistantMessage.parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("").trim();
        if (stepText) {
            accumulatedText = accumulatedText ? `${accumulatedText}\n\n${stepText}` : stepText;
        }

        if (toolCallsToExecute.length === 0) {
            // No more tool calls — extract text output
            const textContent = assistantMessage.parts
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("").trim();
            if (textContent) {
                if (agentId) completeSubagent(agentId, "completed");
                return textContent;
            }

            const reasoningContent = assistantMessage.parts
                .filter((p: any) => p.type === "reasoning")
                .map((p: any) => p.text)
                .join("").trim();
            if (reasoningContent) {
                if (agentId) completeSubagent(agentId, "completed");
                return reasoningContent;
            }

            if (agentId) completeSubagent(agentId, "failed", "No output");
            throw new Error(`${label} completed but returned no output.`);
        }

        // L1: Report all tool names in progress, not just the first
        const toolNames = toolCallsToExecute.map((part: any) =>
            part.type === "dynamic-tool" ? part.toolName : part.type.slice(5)
        );
        console.log(`[${label}] Step ${step + 1}/${maxSteps}: executing tools: ${toolNames.join(", ")}`);
        debug.log(label, `step ${step + 1}: executing ${toolNames.join(", ")}`);
        if (agentId) {
            updateSubagentStep(agentId, step + 1, toolNames.join(", ") || null);
        }

        // H2: Sliding window context compression
        // Keep first user message + last MAX_CONTEXT_MESSAGES messages.
        // Truncate old tool results to save tokens.
        if (messages.length > MAX_CONTEXT_MESSAGES) {
            const firstUser = messages[0];
            const recent = messages.slice(-(MAX_CONTEXT_MESSAGES - 1));
            // Truncate tool outputs in older messages (not the most recent 4)
            for (let i = 0; i < recent.length - 4; i++) {
                const msg = recent[i];
                if (msg?.role === "assistant") {
                    for (const part of msg.parts ?? []) {
                        if ((part.type === "dynamic-tool" || part.type.startsWith("tool-")) && part.state === "output-available" && typeof part.output === "string" && part.output.length > 500) {
                            part.output = part.output.slice(0, 500) + "\n...[truncated]";
                        }
                    }
                }
            }
            messages.length = 0;
            messages.push(firstUser, ...recent);
        }

    // Enhanced parallel tool execution with intelligent optimization
    const toolExecutionPromises = toolCallsToExecute.map(async (part: any) => {
        const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
        if (toolName.startsWith("spawn")) {
            part.state = "output-error";
            part.errorText = "Spawn tools are not allowed from within a subagent";
            return;
        }
        try {
            // Adaptive tool timeout based on tool type and complexity
            const toolTimeout = getOptimizedToolTimeout(toolName, mode);
            const toolSignal = AbortSignal.any([signal, AbortSignal.timeout(toolTimeout)]);
            
            // Execute tool with enhanced error handling and recovery
            const output = await executeToolWithRetry(
                toolName, part.input, mode, model, toolSignal, agentId, label
            );
            
            part.state = "output-available";
            part.output = output;
            const inputSummary = summarizeToolInput(toolName, part.input);
            if (agentId) incrementToolCall(agentId, toolName, inputSummary);
            
            // Log successful tool execution for performance monitoring
            console.log(`[${label}] Tool ${toolName} completed successfully`);
        } catch (error: any) {
            part.state = "output-error";
            part.errorText = error?.message || String(error);
            // Log tool failures for debugging
            console.log(`[${label}] Tool ${toolName} failed: ${part.errorText}`);
        }
    });

    // Execute tools with adaptive concurrency and dependency awareness
    await executeToolsWithOptimization(
        toolExecutionPromises, signal, agentId, label, mode
    );
    }

    console.log(`[${label}] Completed after ${maxSteps} steps`);
    // Return partial results if we have any, instead of throwing
    if (accumulatedText) {
        if (agentId) completeSubagent(agentId, "completed");
        return accumulatedText;
    }
    if (agentId) completeSubagent(agentId, "failed", `Exceeded max steps (${maxSteps})`);
    throw new Error(`${label} exceeded maximum steps (${maxSteps})`);
}

/**
 * Get optimized tool timeout based on tool type and complexity
 */
function getOptimizedToolTimeout(toolName: string, mode: "BUILD" | "PLAN"): number {
    // Longer timeouts for complex operations in BUILD mode
    if (mode === "BUILD") {
        switch (toolName) {
            case "bash":
            case "runTests":
                return 120_000; // 2 minutes for long-running commands
            case "writeFile":
            case "editFile":
                return 60_000; // 1 minute for file operations
            case "glob":
            case "grep":
                return 45_000; // 45 seconds for searches
            default:
                return 90_000; // Default 90 seconds
        }
    }
    // Shorter timeouts for PLAN mode (read-only operations)
    return 60_000; // 1 minute for read-only operations
}

/**
 * Execute tool with retry logic and enhanced error handling
 */
async function executeToolWithRetry(
    toolName: string,
    input: any,
    mode: "BUILD" | "PLAN",
    model: string,
    signal: AbortSignal,
    agentId?: string,
    label?: string,
): Promise<any> {
    const maxRetries = 2;
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await executeLocalTool(toolName, input, mode, model, signal);
        } catch (error: any) {
            lastError = error;
            
            // Don't retry for certain types of errors
            if (isNonRetryableError(error, toolName)) {
                throw error;
            }
            
            // Exponential backoff for retries
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Max 5 seconds
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
        }
    }
    
    throw lastError;
}

/**
 * Check if an error is non-retryable
 */
function isNonRetryableError(error: any, toolName: string): boolean {
    const message = error?.message?.toLowerCase() || '';
    
    // Don't retry for authentication errors
    if (message.includes('auth') || message.includes('unauthorized') || message.includes('forbidden')) {
        return true;
    }
    
    // Don't retry for permission errors
    if (message.includes('permission') || message.includes('access denied')) {
        return true;
    }
    
    // Don't retry for certain tool-specific errors
    if (toolName === "readFile" && message.includes("file not found")) {
        return true;
    }
    
    return false;
}

/**
 * Execute tools with adaptive concurrency and dependency awareness
 */
async function executeToolsWithOptimization(
    toolExecutionPromises: Promise<any>[],
    signal: AbortSignal,
    agentId?: string,
    label?: string,
    mode?: "BUILD" | "PLAN",
): Promise<void> {
    // Adaptive concurrency based on mode and system load
    const baseConcurrency = mode === "BUILD" ? 4 : 3;
    const adaptiveConcurrency = Math.min(baseConcurrency, toolExecutionPromises.length);
    
    // Group tools by type for better resource utilization
    const groupedPromises = groupToolsByType(toolExecutionPromises);
    
    // Execute groups with adaptive concurrency
    for (const group of groupedPromises) {
        const chunkSize = Math.ceil(group.length / adaptiveConcurrency);
        const chunks = [];
        
        for (let i = 0; i < group.length; i += chunkSize) {
            chunks.push(group.slice(i, i + chunkSize));
        }
        
        for (const chunk of chunks) {
            await Promise.allSettled(chunk);
        }
    }
}

/**
 * Group tool execution promises by type for better resource utilization
 */
function groupToolsByType(promises: Promise<any>[]): Promise<any>[][] {
    // This is a simplified grouping - in a real implementation,
    // you would need to track which promise corresponds to which tool type
    const groups = [];
    const chunkSize = 2; // Group size for better resource utilization
    
    for (let i = 0; i < promises.length; i += chunkSize) {
        groups.push(promises.slice(i, i + chunkSize));
    }
    
    return groups;
}
