import { z } from 'zod';
import { tool } from 'ai';

// ─── Multimodal content types ────────────────────────────────────────────────

export interface ImageContent {
    type: 'image';
    image: string; // base64 data URL
}

export interface TextContent {
    type: 'text';
    text: string;
}

export type MessageContent = TextContent | ImageContent;

// ─── Branch types ────────────────────────────────────────────────────────────

export interface ConversationBranch {
    id: string;
    parentBranchId?: string;
    parentMessageIndex?: number;
    name: string;
    createdAt: string;
}

export interface SessionWithBranches {
    id: string;
    branches: ConversationBranch[];
    activeBranchId: string;
}

// ─── Modes ───────────────────────────────────────────────────────────────────

export const Mode = {
    BUILD: 'BUILD',
    PLAN: 'PLAN',
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);

export type ModeType = (typeof Mode)[keyof typeof Mode];

export const toolInputSchemas = {
    read_file: z.object({
        path: z.string().describe('Relative path to the file to read'),
        offset: z
            .number()
            .optional()
            .describe(
                'Line number to start reading from (1-indexed, optional)',
            ),
        limit: z
            .number()
            .optional()
            .describe('Number of lines to return (optional)'),
        infoOnly: z
            .boolean()
            .optional()
            .describe(
                'If true, only return file metadata (size, lines, modified time) instead of reading contents',
            ),
        checkExternalChanges: z
            .boolean()
            .optional()
            .describe('If true, check for files modified externally'),
        externalChangesSince: z
            .number()
            .optional()
            .describe(
                'Optional timestamp (ms) to check external changes after',
            ),
        clearExternalChanges: z
            .boolean()
            .optional()
            .describe(
                'If true, clear the external change history after querying',
            ),
    }),

    write_file: z.object({
        path: z
            .string()
            .describe('Relative path to write or directory to create'),
        content: z
            .string()
            .optional()
            .describe(
                'File contents. If omitted, a directory will be created at the path',
            ),
    }),

    edit_file: z.object({
        action: z
            .enum(['edit', 'patch', 'search_replace', 'delete', 'move', 'undo'])
            .describe('The file modification action to perform'),
        path: z
            .string()
            .optional()
            .describe('Relative path to the file to edit/delete/move'),
        oldString: z
            .string()
            .optional()
            .describe(
                'Exact string to replace (required for edit action). Must match target text exactly.',
            ),
        newString: z
            .string()
            .optional()
            .describe('Replacement string for edit action'),
        patch: z
            .string()
            .optional()
            .describe(
                'The unified diff patch to apply (required for patch action)',
            ),
        pattern: z
            .string()
            .optional()
            .describe(
                'Regex pattern to search for (required for search_replace action)',
            ),
        replacement: z
            .string()
            .optional()
            .describe('Replacement string for search_replace action'),
        glob: z
            .string()
            .optional()
            .describe(
                'Glob pattern to match files (required for search_replace action)',
            ),
        flags: z
            .string()
            .default('g')
            .describe('Regex flags for search_replace action (default: g)'),
        recursive: z
            .boolean()
            .default(false)
            .describe('Delete directory recursively (for delete action)'),
        to: z
            .string()
            .optional()
            .describe('Relative destination path (required for move action)'),
    }),

    list_dir: z.object({
        path: z
            .string()
            .default('.')
            .describe('Relative directory path to list or search'),
        recursive: z
            .boolean()
            .default(false)
            .describe(
                'If true, traverse subdirectories recursively (similar to tree tool)',
            ),
        depth: z
            .number()
            .default(3)
            .describe(
                'Maximum traversal depth for recursive listing (default: 3)',
            ),
        pattern: z
            .string()
            .optional()
            .describe(
                'Optional glob pattern to filter files (similar to glob tool)',
            ),
    }),

    run_command: z.object({
        action: z
            .enum([
                'bash',
                'repl',
                'package_manager',
                'env',
                'process',
                'validate_code',
                'profile_code',
                'token_count',
                'web_fetch',
            ])
            .describe('Execution action to perform'),
        command: z
            .string()
            .optional()
            .describe(
                'Shell/REPL command to run (required for bash/repl actions)',
            ),
        timeout: z
            .number()
            .default(30_000)
            .describe('Timeout in milliseconds (default: 30000)'),
        pmAction: z
            .enum(['install', 'add', 'remove', 'update', 'list', 'outdated'])
            .optional()
            .describe('Package manager operation'),
        pmPackages: z
            .array(z.string())
            .optional()
            .describe('Package names for package_manager add/remove'),
        pmIsDev: z
            .boolean()
            .default(false)
            .describe('Install as dev dependency'),
        packageManager: z
            .enum(['npm', 'yarn', 'pnpm', 'bun', 'auto'])
            .default('auto')
            .describe('Package manager to use (default: auto)'),
        envAction: z
            .enum(['read', 'list', 'add', 'update', 'delete'])
            .optional()
            .describe('Env file action'),
        envKey: z.string().optional().describe('Environment variable key'),
        envValue: z.string().optional().describe('Environment variable value'),
        envFile: z.string().optional().describe('Relative path to .env file'),
        procAction: z
            .enum(['list', 'kill', 'list-ports'])
            .optional()
            .describe('Process operation'),
        procPort: z.number().optional().describe('Port to check'),
        procPid: z.number().optional().describe('PID to kill'),
        procName: z.string().optional().describe('Filter processes by name'),
        procForce: z.boolean().default(false).describe('Force kill process'),
        valFiles: z
            .array(z.string())
            .optional()
            .describe(
                'Optional files to validate. If omitted, checks modified files.',
            ),
        valTypecheck: z.boolean().default(true).describe('Run type checking'),
        valLint: z.boolean().default(true).describe('Run linting'),
        valTest: z.boolean().default(false).describe('Run tests'),
        valAutoFix: z.boolean().default(true).describe('Auto-fix lint issues'),
        profFilter: z
            .string()
            .optional()
            .describe('Filter benchmarks by name/pattern'),
        profCommand: z.string().optional().describe('Custom benchmark command'),
        tcText: z.string().optional().describe('Text to count tokens for'),
        wfUrl: z.string().optional().describe('Full URL to fetch'),
        wfMethod: z
            .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
            .default('GET')
            .describe('HTTP method'),
        wfHeaders: z
            .record(z.string(), z.string())
            .optional()
            .describe('Optional request headers'),
        wfBody: z.string().optional().describe('Request body'),
    }),

    code_search: z.object({
        action: z
            .enum(['search', 'semantic', 'outline', 'diff', 'rename_symbol'])
            .describe('Code search/analysis action to perform'),
        symbol: z
            .string()
            .optional()
            .describe('Symbol name to search or rename'),
        path: z
            .string()
            .default('.')
            .describe('Directory or file path to start search from'),
        include: z
            .string()
            .optional()
            .describe('Optional glob pattern to filter files'),
        limit: z
            .number()
            .default(20)
            .describe('Maximum results to return for semantic search'),
        nodeType: z
            .enum([
                'file',
                'function',
                'class',
                'interface',
                'type',
                'variable',
                'module',
                'dependency',
                'config',
                'api',
            ])
            .optional()
            .describe('Filter semantic search by node type'),
        pathB: z.string().optional().describe('Second file path to diff'),
        newName: z.string().optional().describe('New symbol name for rename'),
        glob: z
            .string()
            .optional()
            .describe('Glob pattern for rename (e.g. src/**/*.ts)'),
        dryRun: z
            .boolean()
            .default(false)
            .describe('Preview rename changes without applying'),
        fileTypes: z
            .array(z.string())
            .optional()
            .describe('Restrict rename to specific file types'),
        query: z
            .string()
            .optional()
            .describe('Search query for semantic search'),
    }),

    git_operation: z.object({
        action: z
            .enum([
                'status',
                'diff',
                'commit',
                'branch',
                'log',
                'blame',
                'status_extended',
                'operations',
                'review_pr',
            ])
            .describe('Git operation to perform'),
        path: z.string().optional().describe('Relative path for diff or blame'),
        staged: z
            .boolean()
            .default(false)
            .describe('Show staged diff instead of unstaged'),
        message: z.string().optional().describe('Commit or stash message'),
        files: z
            .array(z.string())
            .optional()
            .describe('Files to auto-stage before commit'),
        branchAction: z
            .enum(['create', 'list', 'delete', 'checkout'])
            .optional()
            .describe('Branch subcommand'),
        branchName: z.string().optional().describe('Branch name'),
        limit: z.number().default(20).describe('Max commits to return in log'),
        oneline: z
            .boolean()
            .default(true)
            .describe('One line per commit in log'),
        author: z
            .string()
            .optional()
            .describe('Filter commits by author in log'),
        startLine: z
            .number()
            .optional()
            .describe('Start line for blame (1-indexed)'),
        endLine: z
            .number()
            .optional()
            .describe('End line for blame (1-indexed)'),
        gitOp: z
            .enum([
                'merge',
                'stash',
                'stashPop',
                'stashList',
                'push',
                'pull',
                'fetch',
            ])
            .optional()
            .describe('Git subcommand operation'),
        remote: z.string().default('origin').describe('Remote name'),
        forceWithLease: z
            .boolean()
            .default(false)
            .describe('Force push with lease'),
        prUrl: z.string().optional().describe('GitHub PR URL for review'),
        prFocus: z.string().optional().describe('Focus area for PR review'),
        prModel: z.string().optional().describe('Model to use for PR review'),
    }),

    knowledge_graph: z.object({
        action: z
            .enum([
                'build',
                'query',
                'neighbors',
                'add_node',
                'add_edge',
                'detect_cycles',
                'stats',
                'impact',
                'breaking_check',
                'suggest_migration',
            ])
            .describe('Knowledge graph action to perform'),
        includePatterns: z
            .array(z.string())
            .optional()
            .describe('File patterns to include in build'),
        excludePatterns: z
            .array(z.string())
            .optional()
            .describe('Patterns to exclude in build'),
        nodeType: z
            .enum([
                'file',
                'function',
                'class',
                'interface',
                'type',
                'variable',
                'module',
                'dependency',
                'config',
                'api',
            ])
            .optional()
            .describe('Filter query by node type'),
        name: z.string().optional().describe('Filter query by name'),
        filePath: z.string().optional().describe('Filter query by file path'),
        exported: z.boolean().optional().describe('Filter query by exported'),
        limit: z
            .number()
            .default(50)
            .describe('Max results for query (default: 50)'),
        nodeId: z
            .string()
            .optional()
            .describe('Node ID for neighbors/add/impact/breaking/migration'),
        maxDepth: z
            .number()
            .default(1)
            .describe('Max depth for neighbors (default: 1)'),
        nodeName: z.string().optional().describe('Name for added node'),
        nodeDescription: z
            .string()
            .optional()
            .describe('Description for added node'),
        source: z.string().optional().describe('Source node ID for edge'),
        target: z.string().optional().describe('Target node ID for edge'),
        edgeType: z
            .enum([
                'imports',
                'exports',
                'calls',
                'depends-on',
                'defines',
                'extends',
                'implements',
                'uses',
                'references',
                'configures',
            ])
            .optional()
            .describe('Relationship type for edge'),
        edgeFilePath: z
            .string()
            .optional()
            .describe('File path containing edge'),
        keptExports: z
            .array(z.string())
            .optional()
            .describe('Kept exports for breaking change check'),
        newName: z.string().optional().describe('New name for migration'),
        newFilePath: z
            .string()
            .optional()
            .describe('New file path for migration'),
    }),

    spawn_agent: z.object({
        task: z
            .string()
            .describe(
                'Task description for the subagent. Crucial: specify all instructions and context explicitly.',
            ),
        model: z.string().optional().describe('Model ID to use'),
        mode: z.enum(['BUILD', 'PLAN']).describe('Subagent execution mode'),
        preset: z
            .enum([
                'none',
                'reviewer',
                'tester',
                'debugger',
                'refactor',
                'researcher',
            ])
            .default('none')
            .describe('Preset agent configuration'),
        files: z
            .array(z.string())
            .optional()
            .describe('Relative paths to focus on (for preset subagents)'),
        focus: z.string().optional().describe('Focus area for reviewer'),
        testFramework: z
            .string()
            .optional()
            .describe('Test framework for tester'),
        instructions: z
            .string()
            .optional()
            .describe('Refactoring instructions for refactor preset'),
        question: z
            .string()
            .optional()
            .describe('Research question for researcher preset'),
        shouldDelegateTask: z
            .string()
            .optional()
            .describe(
                'If provided, analyze this task description and recommend whether to delegate (replaces shouldDelegate)',
            ),
    }),

    orchestrate_task: z.object({
        action: z
            .enum([
                'orchestrate',
                'status',
                'cancel',
                'checklist_create',
                'checklist_update',
                'checklist_complete',
                'checklist_remove',
                'checklist_list',
                'declare_confidence',
            ])
            .describe('Orchestration or checklist task action'),
        task: z
            .string()
            .optional()
            .describe('Task to orchestrate (required for orchestrate action)'),
        context: z
            .string()
            .optional()
            .describe('Additional context for orchestrate action'),
        strategy: z
            .enum(['balanced', 'speed', 'quality'])
            .default('balanced')
            .describe('Concurrency strategy'),
        maxConcurrency: z
            .number()
            .default(5)
            .describe('Max concurrent workers'),
        maxDurationMs: z.number().optional().describe('Max worker duration'),
        graphId: z.string().optional().describe('Task graph ID'),
        taskId: z
            .string()
            .optional()
            .describe('Task ID within checklist or graph'),
        checklistTasks: z
            .array(
                z.object({
                    id: z.string().describe('Unique checklist task ID'),
                    description: z
                        .string()
                        .describe('Checklist task description'),
                }),
            )
            .optional()
            .describe('Checklist tasks to create'),
        checklistStatus: z
            .enum(['pending', 'in-progress', 'completed', 'failed'])
            .optional()
            .describe('Checklist task status to update'),
        confidence: z
            .enum(['high', 'medium', 'low'])
            .optional()
            .describe('Confidence level to declare'),
        reasoning: z
            .string()
            .optional()
            .describe('Reasoning for confidence declaration'),
        suggestedApproach: z
            .string()
            .optional()
            .describe('Suggested approach for confidence declaration'),
    }),

    workspace_memory: z.object({
        action: z
            .enum([
                'set',
                'get',
                'delete',
                'list',
                'search',
                'fuzzy_search',
                'stats',
            ])
            .describe('Memory operation to perform'),
        key: z.string().optional().describe('Memory key'),
        value: z.string().optional().describe('Value to store'),
        tags: z
            .array(z.string())
            .optional()
            .describe('Tags for categorization'),
        ttlMs: z.number().optional().describe('Memory time-to-live'),
        tag: z.string().optional().describe('Filter listing by tag'),
        query: z.string().optional().describe('Search query'),
        maxDist: z
            .number()
            .default(2)
            .describe('Fuzzy match distance (default: 2)'),
    }),

    manage_keychain: z.object({
        action: z.enum(['set', 'get', 'delete']).describe('Keychain operation'),
        name: z.string().describe('Secret key name'),
        value: z.string().optional().describe('Secret value to store'),
    }),

    ask_question: z.object({
        questions: z
            .array(
                z.object({
                    question: z
                        .string()
                        .describe('The question to ask the user'),
                    choices: z
                        .array(z.string())
                        .optional()
                        .describe('Predefined answer choices (optional)'),
                    allowCustom: z
                        .boolean()
                        .optional()
                        .default(true)
                        .describe('Allow custom text entry (default: true)'),
                }),
            )
            .min(1)
            .max(10)
            .describe('Array of 1-10 questions to ask the user'),
    }),

    use_skill: z.object({
        action: z.enum(['use', 'list']).describe('Skill operation'),
        name: z.string().optional().describe('Skill name to load'),
    }),
} as const;

export const readOnlyToolContracts = {
    read_file: tool({
        description:
            'Read a file from the current project directory or check for external modifications.',
        inputSchema: toolInputSchemas.read_file,
    }),
    list_dir: tool({
        description:
            'List or search files/directories under the current project directory.',
        inputSchema: toolInputSchemas.list_dir,
    }),
    code_search: tool({
        description:
            'Search for symbol definitions, semantic concepts, file outlines, diffs, or rename symbols.',
        inputSchema: toolInputSchemas.code_search,
    }),
    git_operation: tool({
        description:
            'Perform git operations including status, diff, log, blame, commits, branches, and PR reviews.',
        inputSchema: toolInputSchemas.git_operation,
    }),
    knowledge_graph: tool({
        description:
            'Query, build, analyze, or manually adjust the code base relationship knowledge graph.',
        inputSchema: toolInputSchemas.knowledge_graph,
    }),
    spawn_agent: tool({
        description:
            'Spawn a subagent (general or preset code reviewer, tester, debugger, refactor, researcher) or request task delegation suggestions.',
        inputSchema: toolInputSchemas.spawn_agent,
    }),
    workspace_memory: tool({
        description:
            'Store, retrieve, list, search, fuzzy search, or query statistics for persistent session memories.',
        inputSchema: toolInputSchemas.workspace_memory,
    }),
    ask_question: tool({
        description:
            'Ask the user questions and get free-text or single-choice answers.',
        inputSchema: toolInputSchemas.ask_question,
    }),
    use_skill: tool({
        description:
            'Load instructions for specialized skills or list available skill names.',
        inputSchema: toolInputSchemas.use_skill,
    }),
} as const;

export const buildToolContracts = {
    ...readOnlyToolContracts,
    write_file: tool({
        description:
            'Create or overwrite a file, or create directories under the current project directory.',
        inputSchema: toolInputSchemas.write_file,
    }),
    edit_file: tool({
        description:
            'Modify file contents (precise edit, unified patch, regex search-replace, delete, move, or undo).',
        inputSchema: toolInputSchemas.edit_file,
    }),
    run_command: tool({
        description:
            'Execute shell commands, background REPLs, package manager queries, environment variables, processes, validations (typecheck/lint/test), profiling, token counting, or web fetching.',
        inputSchema: toolInputSchemas.run_command,
    }),
    orchestrate_task: tool({
        description:
            'Decompose and coordinate complex tasks with parallel worker agents, manage checklist tasks, or declare execution confidence.',
        inputSchema: toolInputSchemas.orchestrate_task,
    }),
    manage_keychain: tool({
        description:
            'Securely set, retrieve, or delete secrets in the operating system keychain.',
        inputSchema: toolInputSchemas.manage_keychain,
    }),
} as const;

export type ToolContracts = typeof buildToolContracts;

export function getToolContracts(mode: ModeType) {
    return mode === Mode.PLAN ? readOnlyToolContracts : buildToolContracts;
}

/**
 * Tools that subagents should NOT receive.
 * Subagents are leaf workers — they must not spawn children or orchestrate.
 */
const SUBAGENT_EXCLUDED_TOOLS = new Set(['orchestrate_task']);

/**
 * Filtered tool contracts for subagent requests.
 */
export function getSubagentToolContracts(mode: ModeType) {
    const base = getToolContracts(mode);
    const filtered: Record<string, any> = {};
    for (const [key, value] of Object.entries(base)) {
        if (!SUBAGENT_EXCLUDED_TOOLS.has(key)) {
            filtered[key] = value;
        }
    }
    return filtered as typeof base;
}
