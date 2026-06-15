import { relative } from 'path';
import { toolInputSchemas, type ModeType } from '@nightcode/shared';
import { getValidAuth } from '@/lib/auth';
import {
    registerSubagent,
    removeSubagent,
    completeSubagent,
    getCurrentToolCallContext,
    consumeExecutionContext,
} from '@/lib/subagent-progress';
import { runSubagentLoop } from '@/lib/subagent-loop';
import { resolveProviderFallback, extractProvider } from '@/lib/model-utils';
import {
    waitForSlot,
    releaseSlot,
    recordProviderLatency,
} from '@/lib/concurrency-limit';
import { undoManager } from '@/lib/undo-manager';
import { runGit } from './utils';
import { getProjectCwd } from '@/lib/workspace-context';

const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (increased from 5)
const MAX_STEPS = 100;

async function injectWorkspaceContext(task: string, cwd: string): Promise<string> {
    const recentFiles = new Set<string>();
    
    // 1. Gather from undo history
    try {
        const undoHistory = undoManager.getHistory();
        for (const entry of undoHistory) {
            if (entry.filePath) {
                const rel = relative(cwd, entry.filePath);
                if (!rel.startsWith('..')) {
                    recentFiles.add(rel);
                }
            }
        }
    } catch {}

    // 2. Gather from git status
    try {
        const gitRes = await runGit(cwd, ['status', '--porcelain']);
        if (gitRes && gitRes.stdout) {
            const lines = gitRes.stdout.split('\n');
            for (const line of lines) {
                if (line.length < 3) continue;
                const rest = line.substring(3);
                const arrowIdx = rest.indexOf(' -> ');
                const file = arrowIdx !== -1 ? rest.substring(arrowIdx + 4) : rest;
                if (file) {
                    recentFiles.add(file);
                }
            }
        }
    } catch {}

    if (recentFiles.size === 0) {
        return task;
    }

    const contextBlock = `\n\n## Workspace Context (Auto-injected from parent session)
Recently modified or active files in the workspace:
${Array.from(recentFiles).map(f => `- ${f}`).join('\n')}

Please focus on these files or inspect them if they are relevant to your task.`;

    return task + contextBlock;
}

export async function spawnAgentTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const { task, model, mode } = toolInputSchemas.spawnAgent.parse(input);
    const resolvedModel =
        model ?? parentModel ?? resolveProviderFallback(parentModel, 'coder');

    if (parentMode === 'PLAN' && mode === 'BUILD') {
        throw new Error(
            'Cannot spawn a BUILD mode subagent from a PLAN mode parent. Please spawn a PLAN mode subagent instead.',
        );
    }

    // C1: Auth check BEFORE acquiring concurrency slot so counter never leaks on auth failure
    const auth = await getValidAuth();
    if (!auth) throw new Error('Not authenticated. Run /login to continue.');

    // Wait for a concurrency slot (up to 30s) instead of failing immediately
    // This allows parallel spawnAgent calls to queue rather than silently fail
    if (!(await waitForSlot(30_000))) {
        throw new Error(
            'Timed out waiting for a concurrency slot. Too many subagents are running.',
        );
    }

    const subagentId = crypto.randomUUID();
    const provider = extractProvider(resolvedModel);
    const toolCallId = execId
        ? consumeExecutionContext(execId)
        : getCurrentToolCallContext();
    registerSubagent(subagentId, task, MAX_STEPS, toolCallId ?? undefined);

    // Setup timeout and abort wiring
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
        () => timeoutController.abort(),
        SUBAGENT_TIMEOUT_MS,
    );

    const combinedController = new AbortController();
    const onTimeout = () =>
        combinedController.abort(timeoutController.signal.reason);
    const onCaller = () => combinedController.abort(signal?.reason);
    timeoutController.signal.addEventListener('abort', onTimeout, {
        once: true,
    });
    signal?.addEventListener('abort', onCaller, { once: true });

    const startTime = Date.now();
    const cwd = getProjectCwd();
    const taskWithContext = await injectWorkspaceContext(task, cwd);

    try {
        const result = await runSubagentLoop({
            prompt: taskWithContext,
            mode: mode as 'BUILD' | 'PLAN',
            model: resolvedModel,
            auth,
            signal: combinedController.signal,
            maxSteps: MAX_STEPS,
            agentId: subagentId,
            label: 'subagent',
        });
        const elapsed = Date.now() - startTime;
        // Enhanced provider latency tracking with task type information
        recordProviderLatency(provider, elapsed, true, mode);
        return { result };
    } catch (err: any) {
        const isTimeout = timeoutController.signal.aborted && !signal?.aborted;
        const elapsed = Date.now() - startTime;
        // Enhanced provider latency tracking with task type information
        recordProviderLatency(provider, elapsed, false, mode);

        if (isTimeout) {
            // Try to get partial results from the subagent loop
            const partialResult = (err as any).partialResult;
            completeSubagent(
                subagentId,
                'failed',
                `Timed out after ${SUBAGENT_TIMEOUT_MS / 60000}m`,
            );
            if (partialResult) {
                return { result: partialResult };
            }
            throw new Error(
                `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60000} minutes`,
                { cause: err },
            );
        }

        completeSubagent(subagentId, 'failed', err.message);
        throw err;
    } finally {
        clearTimeout(timeoutId);
        timeoutController.signal.removeEventListener('abort', onTimeout);
        signal?.removeEventListener('abort', onCaller);
        releaseSlot();
        // Delay removal so the UI has time to show the completed/failed status
        setTimeout(() => removeSubagent(subagentId), 3_000);
    }
}
