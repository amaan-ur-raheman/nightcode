import { Mode, type ModeType } from '@nightcode/shared';
import { batchManager } from './batch-manager';
import { toolAnalytics } from './tool-analytics';
import { runWithToolExecutionPolicy } from './tool-execution-policy';
import { autoFixPipeline } from './auto-fix-pipeline';
import { fileWatcher } from './file-watcher';
import { resolve } from 'path';
import { toolOutputCache } from './tool-output-cache';

const PLAN_TOOLS = new Set([
    'readFile',
    'listDirectory',
    'glob',
    'grep',
    'tree',
    'fileInfo',
    'gitStatus',
    'gitDiff',
    'webFetch',
    'codeSearch',
    'getOutline',
    'diffFiles',
    'spawnAgent',
    'spawnResearcher',
    'gitLog',
    'gitBlame',
    'gitStatusExtended',
    'tokenCount',
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
    'getTaskStatus',
    'cancelTask',
    'orchestrator', // Tool checks BUILD mode internally and throws with a descriptive error
    'askQuestion',
    'useSkill',
    'listSkills',
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
    'checkExternalChanges',
    'reviewPr',
    'semanticSearch',
    'profileCode',
]);

/**
 * Tools that modify files on disk. After successful execution, we record the
 * modified file path in the auto-fix pipeline for deferred validation.
 */
const FILE_MODIFYING_TOOLS = new Set([
    'writeFile',
    'editFile',
    'patch',
    'deleteFile',
    'moveFile',
]);

/**
 * Advisory validation for destructive operations.
 * Logs warnings for high-risk operations without blocking execution.
 */
const DESTRUCTIVE_OPERATIONS: Record<
    string,
    (input: unknown) => string | null
> = {
    deleteFile: (input) => {
        const path = (input as any)?.path ?? (input as any)?.filePath;
        return path ? `Deleting file: ${path}` : 'Deleting a file';
    },
    moveFile: (input) => {
        const from = (input as any)?.from ?? (input as any)?.source;
        const to = (input as any)?.to ?? (input as any)?.destination;
        return `Moving file: ${from} → ${to}`;
    },
    gitCommit: (input) => {
        const msg =
            (input as any)?.message ??
            (input as any)?.commitMessage ??
            (input as any)?.msg;
        return msg
            ? `Committing: "${String(msg).slice(0, 60)}"`
            : 'Creating a git commit';
    },
    gitBranch: (input) => {
        const name =
            (input as any)?.name ??
            (input as any)?.branch ??
            (input as any)?.branchName;
        return name ? `Creating branch: ${name}` : 'Creating a git branch';
    },
    searchReplace: () =>
        'Performing search-replace (may affect multiple files)',
    renameSymbol: (input) => {
        const from = (input as any)?.oldName;
        const to = (input as any)?.newName;
        return from && to
            ? `Renaming symbol: ${from} → ${to}`
            : 'Renaming a symbol';
    },
};

function getAdvisoryWarning(toolName: string, input: unknown): string | null {
    const checker = DESTRUCTIVE_OPERATIONS[toolName];
    if (!checker) return null;
    return checker(input);
}

/**
 * Extract the modified file path from a tool's input/output.
 * Returns the resolved absolute path, or null if not determinable.
 */
function extractModifiedFilePath(
    toolName: string,
    input: unknown,
): string | null {
    const inp = input as Record<string, unknown> | undefined;

    const cwd = process.cwd();

    switch (toolName) {
        case 'writeFile':
        case 'editFile': {
            const p = typeof inp?.path === 'string' ? inp.path : null;
            return p ? resolve(cwd, p) : null;
        }
        case 'patch': {
            const file = typeof inp?.file === 'string' ? inp.file : null;
            return file ? resolve(cwd, file) : null;
        }
        case 'moveFile': {
            const to = typeof inp?.to === 'string' ? inp.to : null;
            return to ? resolve(cwd, to) : null;
        }
        case 'deleteFile': {
            const p = typeof inp?.path === 'string' ? inp.path : null;
            return p ? resolve(cwd, p) : null;
        }
        default:
            return null;
    }
}

async function directExecute(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
): Promise<unknown> {
    const startTime = Date.now();
    let success = true;

    // Check tool output cache for read-only tools
    const cachedResult = toolOutputCache.get(toolName, input);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    // Advisory validation: log warnings for destructive operations
    const advisory = getAdvisoryWarning(toolName, input);
    if (advisory) {
        console.warn(`[advisory] ${advisory}`);
    }

    try {
        const { loadTool } = await import('./tools/index');
        const tool = await loadTool(toolName);
        const result = await runWithToolExecutionPolicy(
            toolName,
            input,
            signal,
            (toolSignal) => tool(input, mode, parentModel, toolSignal, execId),
            parentModel,
        );

        // Cache the result for future identical calls
        toolOutputCache.set(toolName, input, result);

        // Track file modifications for the auto-fix pipeline and invalidate cache
        if (FILE_MODIFYING_TOOLS.has(toolName)) {
            const filePath = extractModifiedFilePath(toolName, input);
            if (filePath) {
                autoFixPipeline.recordModification(filePath);
                fileWatcher.recordInternalChange(filePath);
            }
            toolOutputCache.clear();
        } else if (toolName === 'bash' || toolName === 'gitCommit' || toolName === 'gitBranch') {
            toolOutputCache.clear();
        }

        return result;
    } catch (error) {
        success = false;
        throw error;
    } finally {
        const duration = Date.now() - startTime;
        toolAnalytics
            .recordToolCall(toolName, duration, success)
            .catch(() => {});
    }
}

export async function executeLocalTool(
    toolName: string,
    input: unknown,
    mode: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    if (mode === Mode.PLAN && !PLAN_TOOLS.has(toolName)) {
        throw new Error(`Tool ${toolName} is not available in PLAN mode`);
    }

    return batchManager.addRequest(
        toolName,
        input,
        directExecute,
        mode,
        parentModel,
        signal,
        execId,
    );
}
