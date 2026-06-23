import { relative, join } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';
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

export async function injectWorkspaceContext(
    task: string,
    cwd: string,
): Promise<string> {
    const recentFiles = new Set<string>();
    const gitLogLines: string[] = [];
    const projectStructure: string[] = [];
    const fileSummaries: string[] = [];

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
                const file =
                    arrowIdx !== -1 ? rest.substring(arrowIdx + 4) : rest;
                if (file) {
                    recentFiles.add(file);
                }
            }
        }
    } catch {}

    // 3. Gather recent git log (last 5 commits) for decision context
    try {
        const logRes = await runGit(cwd, [
            'log',
            '--oneline',
            '-5',
            '--format=%h %s',
        ]);
        if (logRes && logRes.stdout) {
            gitLogLines.push(
                ...logRes.stdout
                    .split('\n')
                    .filter((l) => l.trim())
                    .slice(0, 5),
            );
        }
    } catch {}

    // 4. Get top-level project structure (dirs only, depth 1)
    try {
        const entries = readdirSync(cwd).filter(
            (e) => !e.startsWith('.') && e !== 'node_modules',
        );
        for (const entry of entries.slice(0, 15)) {
            try {
                const st = statSync(join(cwd, entry));
                projectStructure.push(st.isDirectory() ? `${entry}/` : entry);
            } catch {}
        }
    } catch {}

    // 5. Generate brief summaries of recently modified files (first 3 lines)
    // Skip binary files by checking for null bytes
    const fileArray = Array.from(recentFiles).slice(0, 5);
    for (const filePath of fileArray) {
        try {
            const absPath = join(cwd, filePath);
            const content = readFileSync(absPath, 'utf-8');
            // Skip binary content (null bytes indicate binary data)
            if (content.includes('\0')) continue;
            const firstLines = content
                .split('\n')
                .slice(0, 3)
                .join('\n')
                .trim();
            if (firstLines) {
                fileSummaries.push(`### ${filePath}\n${firstLines}`);
            }
        } catch {}
    }

    if (
        recentFiles.size === 0 &&
        gitLogLines.length === 0 &&
        projectStructure.length === 0
    ) {
        return task;
    }

    const contextParts: string[] = [
        '\n\n## Workspace Context (Auto-injected from parent session)',
    ];

    if (recentFiles.size > 0) {
        contextParts.push(
            `### Recently Modified Files\n${Array.from(recentFiles)
                .map((f) => `- ${f}`)
                .join('\n')}`,
        );
    }

    if (gitLogLines.length > 0) {
        contextParts.push(
            `### Recent Commits\n${gitLogLines.map((l) => `- ${l}`).join('\n')}`,
        );
    }

    if (projectStructure.length > 0) {
        contextParts.push(
            `### Project Structure\n${projectStructure.join('\n')}`,
        );
    }

    if (fileSummaries.length > 0) {
        contextParts.push(`### File Previews\n${fileSummaries.join('\n\n')}`);
    }

    contextParts.push(
        '\nPlease focus on these files or inspect them if they are relevant to your task.',
    );

    return task + contextParts.join('\n');
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
