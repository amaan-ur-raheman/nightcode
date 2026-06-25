import {
    readUIMessageStream,
    uiMessageChunkSchema,
    parseJsonEventStream,
} from 'ai';
import { executeLocalTool } from './local-tools';
import {
    compressContext,
    detectContextMode,
    estimateTokens as estimateTokensFromContext,
} from './context-compression';
import {
    updateSubagentStep,
    incrementToolCall,
    completeSubagent,
} from './subagent-progress';
import { debug } from './debug';
import { getApiKeyForProvider } from './api-keys';
import { resolveProviderForModel } from '@nightcode/shared';
import {
    ErrorPatternTracker,
    errorPatternTracker,
} from './error-pattern-tracker';
import { correctionTracker } from './correction-tracker';
import {
    isCriticalOperation,
    generateVerificationPrompt,
    calculateConfidence,
} from './self-verification';
import { workspaceLocalStorage, getProjectCwd } from './workspace-context';
import { setupWorktree, teardownWorktree } from './worktree';

const API_URL = process.env.API_URL ?? 'http://localhost:5959';

/**
 * Generate a short human-readable summary of a tool's input.
 * E.g., read_file → "package.json", code_search → "pattern", run_command → "bun test"
 */
function summarizeToolInput(toolName: string, input: any): string {
    if (!input || typeof input !== 'object') return '';
    const truncate = (s: string, max = 40) =>
        s.length > max ? s.slice(0, max - 3) + '...' : s;
    const getAction = (): string =>
        typeof input.action === 'string' ? input.action : '';

    switch (toolName) {
        case 'read_file':
            return typeof input.path === 'string' ? truncate(input.path) : '';
        case 'write_file':
            return typeof input.path === 'string' ? truncate(input.path) : '';
        case 'edit_file': {
            const act = getAction();
            if (act === 'move') {
                return typeof input.path === 'string'
                    ? truncate(input.path)
                    : '';
            }
            return typeof input.path === 'string' ? truncate(input.path) : '';
        }
        case 'list_dir':
            return typeof input.path === 'string'
                ? truncate(input.path)
                : typeof input.directory === 'string'
                  ? truncate(input.directory)
                  : '';
        case 'code_search': {
            const act = getAction();
            if (act === 'outline') {
                return typeof input.path === 'string'
                    ? truncate(input.path)
                    : '';
            }
            if (act === 'diff') {
                return typeof input.path === 'string'
                    ? truncate(input.path)
                    : '';
            }
            if (act === 'rename_symbol') {
                return typeof input.oldName === 'string'
                    ? truncate(input.oldName)
                    : '';
            }
            return typeof input.pattern === 'string'
                ? truncate(input.pattern)
                : typeof input.query === 'string'
                  ? truncate(input.query)
                  : '';
        }
        case 'run_command': {
            const act = getAction();
            if (act === 'bash' || act === 'repl' || act === 'code_analysis') {
                return typeof input.command === 'string'
                    ? truncate(input.command, 50)
                    : '';
            }
            if (act === 'web_fetch') {
                return typeof input.url === 'string'
                    ? truncate(input.url, 50)
                    : '';
            }
            return act || '';
        }
        case 'git_operation': {
            const act = getAction();
            if (act === 'commit') {
                return typeof input.message === 'string'
                    ? truncate(input.message, 40)
                    : '';
            }
            if (act === 'branch') {
                return typeof input.name === 'string'
                    ? truncate(input.name)
                    : typeof input.branch === 'string'
                      ? truncate(input.branch)
                      : '';
            }
            return '';
        }
        case 'spawn_agent':
            return typeof input.task === 'string'
                ? truncate(input.task, 50)
                : '';
        case 'orchestrate_task':
            return typeof input.description === 'string'
                ? truncate(input.description, 50)
                : '';
        case 'workspace_memory':
            return typeof input.key === 'string' ? truncate(input.key) : '';
        case 'manage_keychain':
            return typeof input.key === 'string' ? truncate(input.key) : '';
        case 'knowledge_graph':
            return typeof input.nodeId === 'string'
                ? truncate(input.nodeId)
                : typeof input.query === 'string'
                  ? truncate(input.query)
                  : '';
        case 'ask_question':
            return typeof input.question === 'string'
                ? truncate(input.question, 50)
                : '';
        case 'use_skill':
            return typeof input.name === 'string' ? truncate(input.name) : '';
        default:
            // For unknown tools, try to show the first string value from input
            for (const val of Object.values(input)) {
                if (typeof val === 'string' && val.length > 0)
                    return truncate(val);
            }
            return '';
    }
}

export type SubagentLoopConfig = {
    /** The initial user prompt/task for the subagent */
    prompt: string;
    /** BUILD or PLAN mode */
    mode: 'BUILD' | 'PLAN';
    /** Model ID */
    model: string;
    /** Auth data — used as initial token, refreshed on 401 */
    auth: { token: string };
    /** Abort signal for cancellation */
    signal: AbortSignal;
    /** Max steps before giving up (default 100) */
    maxSteps?: number;
    /** Agent ID for progress tracking (if omitted, no progress updates) */
    agentId?: string;
    /** Label for logging (default "subagent") */
    label?: string;
    /** Max retries for rate-limited requests (default 5) */
    maxRetries?: number;
    /** Max messages to keep in context window (default 30) */
    maxContextMessages?: number;
    /** Max tokens budget for context (default 100000). Triggers compression when exceeded. */
    maxTokens?: number;
    /** Per-step timeout in ms (default 90000). Steps exceeding this are aborted. */
    stepTimeoutMs?: number;
    /** Enable self-verification before completion (default true) */
    selfVerify?: boolean;
    /** If set, save checkpoints after each step for crash recovery. */
    checkpointId?: string;
    /** If set, error pattern tracking will be enabled for this loop. */
    errorTracker?: ErrorPatternTracker;
};

// ── Subagent Checkpoint Persistence ──
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CHECKPOINT_DIR = join(homedir(), '.nightcode', 'subagent-checkpoints');

interface SubagentCheckpoint {
    checkpointId: string;
    messages: any[];
    step: number;
    accumulatedText: string;
    savedAt: number;
}

async function saveSubagentCheckpoint(
    checkpointId: string,
    messages: any[],
    step: number,
    accumulatedText: string,
): Promise<void> {
    try {
        await mkdir(CHECKPOINT_DIR, { recursive: true });
        const data: SubagentCheckpoint = {
            checkpointId,
            messages,
            step,
            accumulatedText,
            savedAt: Date.now(),
        };
        const filePath = join(CHECKPOINT_DIR, `${checkpointId}.json`);
        await writeFile(filePath, JSON.stringify(data), 'utf-8');
    } catch {
        // Non-critical — don't fail the loop
    }
}

export async function loadSubagentCheckpoint(
    checkpointId: string,
): Promise<SubagentCheckpoint | null> {
    try {
        const filePath = join(CHECKPOINT_DIR, `${checkpointId}.json`);
        const raw = await readFile(filePath, 'utf-8');
        return JSON.parse(raw) as SubagentCheckpoint;
    } catch {
        return null;
    }
}

/**
 * Shared subagent execution loop used by both direct subagents (spawn-agent.ts)
 * and orchestrator workers (worker-agent.ts).
 *
 * Handles: streaming, message management, tool execution, rate limiting,
 * abort propagation, and progress tracking.
 */
export async function runSubagentLoop(
    config: SubagentLoopConfig,
): Promise<string> {
    const {
        prompt,
        mode,
        model,
        auth,
        signal,
        maxSteps = 100,
        agentId,
        label = 'subagent',
        maxRetries = 5,
        maxContextMessages = 30,
        maxTokens = 100_000,
        stepTimeoutMs: configuredStepTimeout,
        selfVerify = true,
        checkpointId,
        errorTracker,
    } = config;

    const parentCwd = getProjectCwd();
    let worktreePath = parentCwd;
    let worktreeCreated = false;
    const activeAgentId = agentId ?? crypto.randomUUID();

    // Read project context (rules) from .agentrules
    let projectContext: string | undefined;
    try {
        const rulesPath = join(parentCwd, '.agentrules');
        if (existsSync(rulesPath)) {
            projectContext = readFileSync(rulesPath, 'utf8');
        }
    } catch {}

    // Gather learning signals
    const [corrections, patterns, errorSuggestions] = await Promise.all([
        correctionTracker.getCorrections(),
        correctionTracker.getPatterns(),
        Promise.resolve((errorTracker ?? errorPatternTracker).getSuggestions()),
    ]);

    if (mode === 'BUILD') {
        try {
            worktreePath = await setupWorktree(activeAgentId, parentCwd);
            worktreeCreated = worktreePath !== parentCwd;
        } catch (err) {
            console.error(
                `[${label}] Failed to setup worktree for agent ${activeAgentId}:`,
                err,
            );
            throw err;
        }
    }

    let success = false;
    try {
        const result = await workspaceLocalStorage.run(
            { cwd: worktreePath, agentId: activeAgentId },
            async () => {
                // Track files modified in this session for self-verification
                const filesModified = new Set<string>();
                const executionErrors: string[] = [];
                const toolUsageMap = new Map<string, number>();
                let hasToolResults = false;
                let verificationAttempts = 0;

                const messages: any[] = [
                    {
                        id: crypto.randomUUID(),
                        role: 'user' as const,
                        parts: [{ type: 'text' as const, text: prompt }],
                    },
                ];

                // H2: Maximum messages to keep in context to prevent unbounded growth.
                // Keeps the first user message + last maxContextMessages messages.
                const MAX_CONTEXT_MESSAGES = maxContextMessages;

                // Per-step timeout: if a single step (LLM call + tool execution) takes longer
                // than this, abort the step to prevent runaway generation (e.g. 3K+ token outputs).
                const STEP_TIMEOUT_MS = configuredStepTimeout ?? 90_000;

                // Heartbeat watchdog: if no progress for this long, abort to detect hung connections.
                // Independent of step timeout — detects truly hung connections, not slow steps.
                const HEARTBEAT_TIMEOUT_MS = 180_000; // 3 minutes default

                // Accumulate text output across steps for partial results on timeout
                let accumulatedText = '';

                console.log(
                    `[${label}] Starting: mode=${mode} model=${model} maxSteps=${maxSteps}`,
                );
                console.log(
                    `[${label}] Task: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`,
                );

                // Heartbeat watchdog: creates its own AbortController to avoid hijacking the parent signal.
                // Only monitors the LLM fetch phase — resets before/after tool execution.
                let lastProgressTime = Date.now();
                let heartbeatTimer: ReturnType<typeof setInterval> | null =
                    null;
                const heartbeatController = new AbortController();

                // Link parent abort to heartbeat controller
                if (signal.aborted) {
                    heartbeatController.abort(signal.reason);
                } else {
                    signal.addEventListener(
                        'abort',
                        () => heartbeatController.abort(signal.reason),
                        { once: true },
                    );
                }

                const resetHeartbeat = () => {
                    lastProgressTime = Date.now();
                };

                const pauseHeartbeat = () => {
                    // Pause during tool execution — tools have their own timeouts
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                };

                const resumeHeartbeat = () => {
                    resetHeartbeat();
                    if (heartbeatTimer) return; // Already running
                    heartbeatTimer = setInterval(() => {
                        const elapsed = Date.now() - lastProgressTime;
                        if (elapsed > HEARTBEAT_TIMEOUT_MS) {
                            debug.log(
                                label,
                                `Heartbeat timeout: no progress for ${Math.round(elapsed / 1000)}s, aborting`,
                            );
                            console.log(
                                `[${label}] Heartbeat timeout: no progress for ${Math.round(elapsed / 1000)}s`,
                            );
                            // Only abort our own controller — parent signal is untouched
                            heartbeatController.abort();
                        }
                    }, 10_000);
                };

                resumeHeartbeat();

                // Cache auth token outside the loop to avoid reading from disk on every step.
                // Refresh is only attempted on 401 (proactive expiry check + lazy refresh).
                const { getValidAuth } = await import('@/lib/auth');
                let currentAuth = auth;
                let providerKey: string | null = null;

                // Resolve provider API key once — it doesn't change between steps
                try {
                    const provider = resolveProviderForModel(model);
                    providerKey = await getApiKeyForProvider(provider);
                } catch {
                    // Provider key is optional — some models don't need one
                }

                /** Ensure we have a valid token, refreshing if expired or on explicit request. */
                async function ensureAuth(
                    forceRefresh = false,
                ): Promise<{ token: string }> {
                    if (!forceRefresh) return currentAuth;
                    const refreshed = await getValidAuth();
                    if (refreshed) {
                        currentAuth = refreshed;
                        return refreshed;
                    }
                    return currentAuth;
                }

                try {
                    for (let step = 0; step < maxSteps; step++) {
                        if (
                            signal.aborted ||
                            heartbeatController.signal.aborted
                        ) {
                            // Return partial results instead of throwing on abort
                            if (accumulatedText) {
                                if (agentId)
                                    completeSubagent(agentId, 'completed');
                                return accumulatedText;
                            }
                            const err = new Error(`${label} aborted`);
                            (err as any).partialResult =
                                accumulatedText || undefined;
                            throw err;
                        }

                        // Reset heartbeat at the start of each step
                        resetHeartbeat();

                        // Fetch with retry for rate limits, wrapped with per-step timeout.
                        // Auth is cached — only refreshed on 401 (see recovery below).
                        let response: Response | undefined;
                        const stepSignal = AbortSignal.any([
                            signal,
                            AbortSignal.timeout(STEP_TIMEOUT_MS),
                        ]);

                        const subagentHeaders: Record<string, string> = {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${currentAuth.token}`,
                        };
                        if (providerKey) {
                            subagentHeaders['x-provider-key'] = providerKey;
                        }

                        for (let attempt = 0; attempt < maxRetries; attempt++) {
                            response = await fetch(`${API_URL}/subagent`, {
                                method: 'POST',
                                headers: subagentHeaders,
                                body: JSON.stringify({
                                    messages,
                                    model,
                                    mode,
                                    agentId,
                                    projectContext,
                                    corrections,
                                    positives: patterns?.positives,
                                    errorWarnings: errorSuggestions,
                                }),
                                signal: stepSignal,
                            });
                            if (response.status !== 429) break;
                            // Wait with abort support before retrying
                            await new Promise<void>((resolve, reject) => {
                                if (signal.aborted) {
                                    reject(new Error('Aborted'));
                                    return;
                                }
                                const t = setTimeout(
                                    resolve,
                                    (attempt + 1) * 3000,
                                );
                                signal.addEventListener(
                                    'abort',
                                    () => {
                                        clearTimeout(t);
                                        reject(new Error('Aborted'));
                                    },
                                    { once: true },
                                );
                            });
                        }

                        if (!response || !response.ok) {
                            // 401 recovery: attempt token refresh and retry once
                            if (response?.status === 401) {
                                debug.log(
                                    label,
                                    'Got 401 — attempting token refresh',
                                );
                                const refreshed = await ensureAuth(true);
                                if (refreshed.token !== currentAuth.token) {
                                    // Token was refreshed — retry this step once
                                    console.log(
                                        `[${label}] Token refreshed after 401, retrying step`,
                                    );
                                    subagentHeaders['Authorization'] =
                                        `Bearer ${refreshed.token}`;
                                    response = await fetch(
                                        `${API_URL}/subagent`,
                                        {
                                            method: 'POST',
                                            headers: subagentHeaders,
                                            body: JSON.stringify({
                                                messages,
                                                model,
                                                mode,
                                                agentId,
                                                projectContext,
                                                corrections,
                                                positives: patterns?.positives,
                                                errorWarnings: errorSuggestions,
                                            }),
                                            signal: stepSignal,
                                        },
                                    );
                                }
                            }

                            const body = (await response
                                ?.json()
                                .catch(() => ({}))) as {
                                error?: string;
                            };
                            if (!response || response.status === 429) {
                                throw new Error(
                                    'Rate limit hit. Wait a moment and try again.',
                                );
                            }
                            if (response.status === 401) {
                                throw new Error(
                                    'Session expired. Run /login to continue.',
                                );
                            }
                            if (response.status === 402) {
                                throw new Error(
                                    'No credits remaining. Run /upgrade to buy more credits.',
                                );
                            }
                            throw new Error(
                                body.error ??
                                    `${label} failed with status ${response.status}`,
                            );
                        }

                        if (!response.body) throw new Error('No response body');

                        // Parse streaming response
                        const chunkStream = parseJsonEventStream({
                            stream: response.body,
                            schema: uiMessageChunkSchema,
                        }).pipeThrough(
                            new TransformStream({
                                async transform(chunk, controller) {
                                    if (!chunk.success) throw chunk.error;
                                    controller.enqueue(chunk.value);
                                },
                            }),
                        );

                        const stream = readUIMessageStream({
                            stream: chunkStream,
                        });
                        let assistantMessage: any = null;

                        try {
                            for await (const message of stream) {
                                assistantMessage = message;
                            }
                        } catch (streamErr: any) {
                            const msg = streamErr?.message ?? String(streamErr);
                            if (
                                msg.includes('429') ||
                                msg.toLowerCase().includes('too many requests')
                            ) {
                                throw new Error(
                                    'Rate limit hit. Wait a moment and try again.',
                                    { cause: streamErr },
                                );
                            }
                            throw streamErr;
                        }

                        if (!assistantMessage) {
                            throw new Error(
                                `No message received from ${label}`,
                            );
                        }

                        // Update message list — always append to accumulate full context
                        messages.push(assistantMessage);

                        // Find pending tool calls
                        const toolCallsToExecute =
                            assistantMessage.parts.filter((part: any) => {
                                if (
                                    part.type === 'dynamic-tool' ||
                                    part.type.startsWith('tool-')
                                ) {
                                    return part.state === 'input-available';
                                }
                                return false;
                            });

                        console.log(
                            `[${label}] Step ${step + 1}/${maxSteps}: received response (${assistantMessage.parts.length} parts)`,
                        );

                        // Accumulate text from this step for partial results
                        const stepText = assistantMessage.parts
                            .filter((p: any) => p.type === 'text')
                            .map((p: any) => p.text)
                            .join('')
                            .trim();
                        if (stepText) {
                            accumulatedText = accumulatedText
                                ? `${accumulatedText}\n\n${stepText}`
                                : stepText;
                        }

                        if (toolCallsToExecute.length === 0) {
                            // No more tool calls — extract text output
                            const textContent = assistantMessage.parts
                                .filter((p: any) => p.type === 'text')
                                .map((p: any) => p.text)
                                .join('')
                                .trim();
                            if (textContent) {
                                // Self-verification: if we modified files, inject a verification step
                                if (
                                    selfVerify &&
                                    mode === 'BUILD' &&
                                    filesModified.size > 0 &&
                                    hasToolResults &&
                                    verificationAttempts < 1 &&
                                    !textContent
                                        .toLowerCase()
                                        .includes('verified')
                                ) {
                                    verificationAttempts++;

                                    // Calculate confidence score
                                    const confidence = calculateConfidence(
                                        [...filesModified],
                                        toolUsageMap,
                                        executionErrors,
                                    );
                                    console.log(
                                        `[${label}] Self-verification: confidence=${confidence.overall.toFixed(2)} (${confidence.explanation.join('; ')})`,
                                    );

                                    // Build targeted verification prompt based on confidence
                                    const verifyParts: string[] = [];
                                    if (confidence.overall < 0.8) {
                                        verifyParts.push(
                                            `Confidence score: ${(confidence.overall * 100).toFixed(0)}%`,
                                            ...confidence.explanation.map(
                                                (e) => `  - ${e}`,
                                            ),
                                            '',
                                        );
                                    }
                                    verifyParts.push(
                                        'Before finishing, please verify your changes:',
                                        '1. Check that modified files are syntactically valid (run typecheck/lint if available)',
                                        '2. Confirm the task requirements are met',
                                        '3. If any issues are found, fix them',
                                        '',
                                        'If everything is correct, respond with "verified". If there are issues, describe them.',
                                    );

                                    // Inject a verification prompt as a user message
                                    messages.push({
                                        id: crypto.randomUUID(),
                                        role: 'user' as const,
                                        parts: [
                                            {
                                                type: 'text' as const,
                                                text: verifyParts.join('\n'),
                                            },
                                        ],
                                    });
                                    // Don't return yet — let the loop continue for verification
                                    continue;
                                }
                                if (agentId)
                                    completeSubagent(agentId, 'completed');
                                return textContent;
                            }

                            const reasoningContent = assistantMessage.parts
                                .filter((p: any) => p.type === 'reasoning')
                                .map((p: any) => p.text)
                                .join('')
                                .trim();
                            if (reasoningContent) {
                                if (agentId)
                                    completeSubagent(agentId, 'completed');
                                return reasoningContent;
                            }

                            if (agentId)
                                completeSubagent(
                                    agentId,
                                    'failed',
                                    'No output',
                                );
                            throw new Error(
                                `${label} completed but returned no output.`,
                            );
                        }

                        // L1: Report all tool names in progress, not just the first
                        const toolNames = toolCallsToExecute.map((part: any) =>
                            part.type === 'dynamic-tool'
                                ? part.toolName
                                : part.type.slice(5),
                        );
                        console.log(
                            `[${label}] Step ${step + 1}/${maxSteps}: executing tools: ${toolNames.join(', ')}`,
                        );
                        debug.log(
                            label,
                            `step ${step + 1}: executing ${toolNames.join(', ')}`,
                        );
                        if (agentId) {
                            updateSubagentStep(
                                agentId,
                                step + 1,
                                toolNames.join(', ') || null,
                            );
                        }

                        // H2: Progressive tiered context compression
                        // 3-tier system: Tier 1 (full, last 8 msgs), Tier 2 (summarized, 9-20), Tier 3 (metadata, 20+)
                        // Tool-aware: errors always preserved; read outputs get structure extraction.
                        // Token budget: also compress when estimated tokens exceed budget.
                        const currentTokens = messages.reduce(
                            (sum, msg) => sum + estimateTokensFromContext(msg),
                            0,
                        );
                        const needsCompression =
                            messages.length > MAX_CONTEXT_MESSAGES ||
                            currentTokens > maxTokens;
                        if (needsCompression) {
                            const contextMode = detectContextMode(prompt);
                            // If over token budget, compress more aggressively
                            const overBudget = currentTokens > maxTokens;
                            const tier1Count = overBudget
                                ? Math.max(
                                      4,
                                      Math.round(
                                          (MAX_CONTEXT_MESSAGES - 10) * 0.6,
                                      ),
                                  )
                                : MAX_CONTEXT_MESSAGES - 10;
                            const tier2Count = overBudget ? 6 : 10;
                            const { messages: compressed, stats } =
                                compressContext(messages, {
                                    tier1Count,
                                    tier2Count,
                                    contextMode,
                                });
                            console.log(
                                `[${label}] Context compressed (${stats.contextMode}): ${stats.originalCount} → ${stats.compressedCount} messages (saved ~${stats.tokensSaved} tokens, tier1=${stats.tier1Count} tier2=${stats.tier2Count} tier3=${stats.tier3Count})${overBudget ? ` [over token budget: ${currentTokens}/${maxTokens}]` : ''}`,
                            );
                            messages.length = 0;
                            messages.push(...compressed);
                        }

                        // Enhanced parallel tool execution with intelligent optimization
                        const toolExecutionPromises = toolCallsToExecute.map(
                            async (part: any) => {
                                const toolName =
                                    part.type === 'dynamic-tool'
                                        ? part.toolName
                                        : part.type.slice(5);

                                try {
                                    // Adaptive tool timeout based on tool type and complexity
                                    const toolTimeout = getOptimizedToolTimeout(
                                        toolName,
                                        mode,
                                    );
                                    const toolSignal = AbortSignal.any([
                                        signal,
                                        AbortSignal.timeout(toolTimeout),
                                    ]);

                                    // Execute tool with enhanced error handling and recovery
                                    const output = await executeToolWithRetry(
                                        toolName,
                                        part.input,
                                        mode,
                                        model,
                                        toolSignal,
                                        agentId,
                                        label,
                                    );

                                    part.state = 'output-available';
                                    part.output = output;
                                    const inputSummary = summarizeToolInput(
                                        toolName,
                                        part.input,
                                    );
                                    if (agentId)
                                        incrementToolCall(
                                            agentId,
                                            toolName,
                                            inputSummary,
                                        );

                                    // Track for correction/acceptance feedback loop
                                    correctionTracker.recordAction(
                                        toolName,
                                        part.input,
                                        inputSummary,
                                    );

                                    // Track tool usage for confidence scoring
                                    toolUsageMap.set(
                                        toolName,
                                        (toolUsageMap.get(toolName) ?? 0) + 1,
                                    );

                                    // Track modified files for self-verification
                                    if (
                                        toolName === 'write_file' ||
                                        toolName === 'edit_file'
                                    ) {
                                        const filePath =
                                            typeof part.input?.path === 'string'
                                                ? part.input.path
                                                : typeof part.input?.file ===
                                                    'string'
                                                  ? part.input.file
                                                  : '';
                                        if (filePath)
                                            filesModified.add(filePath);
                                    }
                                    hasToolResults = true;

                                    // Schedule acceptance signal — if user undoes before this fires,
                                    // the undo records a correction and this acceptance is a weak positive.
                                    const acceptTool = toolName;
                                    const acceptInput = part.input;
                                    const acceptDesc = inputSummary;
                                    setTimeout(() => {
                                        correctionTracker
                                            .onAccept(
                                                acceptTool,
                                                acceptInput,
                                                acceptDesc,
                                            )
                                            .catch(() => {});
                                    }, 5_000);

                                    // Multi-pass verification for critical operations
                                    if (
                                        isCriticalOperation(
                                            toolName,
                                            part.input,
                                        )
                                    ) {
                                        console.log(
                                            `[${label}] Critical operation detected: ${toolName}, scheduling verification`,
                                        );
                                        const verifyPrompt =
                                            generateVerificationPrompt(
                                                toolName,
                                                part.input,
                                                output,
                                            );
                                        messages.push({
                                            id: crypto.randomUUID(),
                                            role: 'user' as const,
                                            parts: [
                                                {
                                                    type: 'text' as const,
                                                    text: verifyPrompt,
                                                },
                                            ],
                                        });
                                    }

                                    // Log successful tool execution for performance monitoring
                                    console.log(
                                        `[${label}] Tool ${toolName} completed successfully`,
                                    );
                                } catch (error: any) {
                                    part.state = 'output-error';
                                    part.errorText =
                                        error?.message || String(error);
                                    // Track errors for confidence scoring
                                    executionErrors.push(
                                        part.errorText.slice(0, 200),
                                    );
                                    // Log tool failures for debugging
                                    console.log(
                                        `[${label}] Tool ${toolName} failed: ${part.errorText}`,
                                    );
                                    // Track error patterns and inject suggestions
                                    if (errorTracker) {
                                        const suggestion =
                                            errorTracker.record(error);
                                        if (suggestion) {
                                            part.errorText += `\n\n[Suggestion] ${suggestion}`;
                                        }
                                    }
                                }
                            },
                        );

                        // Pause heartbeat during tool execution — tools have their own timeouts
                        pauseHeartbeat();
                        // Execute all tool calls in parallel
                        await Promise.allSettled(toolExecutionPromises);
                        // Resume heartbeat for the next LLM fetch
                        resumeHeartbeat();

                        // Save checkpoint after each step for crash recovery (fire-and-forget)
                        if (checkpointId) {
                            saveSubagentCheckpoint(
                                checkpointId,
                                messages,
                                step + 1,
                                accumulatedText,
                            ).catch(() => {});
                        }
                    }

                    console.log(`[${label}] Completed after ${maxSteps} steps`);
                    // Return partial results if we have any, instead of throwing
                    if (accumulatedText) {
                        if (agentId) completeSubagent(agentId, 'completed');
                        return accumulatedText;
                    }
                    if (agentId)
                        completeSubagent(
                            agentId,
                            'failed',
                            `Exceeded max steps (${maxSteps})`,
                        );
                    throw new Error(
                        `${label} exceeded maximum steps (${maxSteps})`,
                    );
                } finally {
                    // Save final checkpoint on abort for crash recovery
                    if (checkpointId && accumulatedText) {
                        saveSubagentCheckpoint(
                            checkpointId,
                            messages,
                            -1,
                            accumulatedText,
                        ).catch(() => {});
                    }
                    // Always clean up heartbeat timer and controller
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                    // Unlink parent abort listener if we added one
                    // (heartbeatController is GC'd when function exits)
                }
            },
        );
        success = true;
        return result;
    } finally {
        if (worktreeCreated) {
            await teardownWorktree(
                activeAgentId,
                worktreePath,
                parentCwd,
                success,
            );
        }
    }
}

/**
 * Get optimized tool timeout based on tool type and complexity
 */
function getOptimizedToolTimeout(
    toolName: string,
    mode: 'BUILD' | 'PLAN',
): number {
    // Longer timeouts for complex operations in BUILD mode
    if (mode === 'BUILD') {
        switch (toolName) {
            case 'run_command':
                return 120_000; // 2 minutes for long-running commands
            case 'write_file':
            case 'edit_file':
                return 60_000; // 1 minute for file operations
            case 'code_search':
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
    mode: 'BUILD' | 'PLAN',
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
                await new Promise((resolve) => setTimeout(resolve, delay));
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
    if (
        message.includes('auth') ||
        message.includes('unauthorized') ||
        message.includes('forbidden')
    ) {
        return true;
    }

    // Don't retry for permission errors
    if (message.includes('permission') || message.includes('access denied')) {
        return true;
    }

    // Don't retry for certain tool-specific errors
    if (toolName === 'read_file' && message.includes('file not found')) {
        return true;
    }

    return false;
}
