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
    readFile: z.object({
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
    }),
    listDirectory: z.object({
        path: z
            .string()
            .default('.')
            .describe('Relative directory path to list'),
    }),
    glob: z.object({
        pattern: z.string().describe('Glob pattern to match files'),
        path: z.string().default('.').describe('Directory to search from'),
    }),
    grep: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().default('.').describe('Directory to search from'),
        include: z
            .string()
            .optional()
            .describe('Optional glob for files to include'),
    }),
    tree: z.object({
        path: z.string().default('.').describe('Relative path to start from'),
        depth: z
            .number()
            .default(3)
            .describe('Maximum depth to traverse (default: 3)'),
    }),
    fileInfo: z.object({
        path: z.string().describe('Relative path to the file or directory'),
    }),
    gitStatus: z.object({}),
    gitDiff: z.object({
        path: z
            .string()
            .optional()
            .describe(
                'Relative path to a specific file (optional, omit for full diff)',
            ),
        staged: z
            .boolean()
            .default(false)
            .describe('Show staged (cached) diff instead of unstaged'),
    }),
    webFetch: z.object({
        url: z.string().url().describe('Full URL to fetch'),
        headers: z
            .record(z.string(), z.string())
            .optional()
            .describe('Optional HTTP request headers'),
    }),
    writeFile: z.object({
        path: z.string().describe('Relative path to write'),
        content: z.string().describe('File contents'),
    }),
    editFile: z.object({
        path: z.string().describe('Relative path to edit'),
        oldString: z
            .string()
            .describe(
                'Exact text to replace. It MUST match the target text in the file EXACTLY, including all indentation, leading whitespace, and newlines. If you are unsure of the exact whitespace, use readFile first to inspect it. Must be unique.',
            ),
        newString: z.string().describe('Replacement text'),
    }),
    bash: z.object({
        command: z.string().describe('Shell command to run'),
        timeout: z
            .number()
            .default(30_000)
            .describe('Timeout in milliseconds (default: 30000)'),
    }),
    replExecute: z.object({
        command: z.string().describe('The command to execute in the persistent background REPL session'),
    }),
    patch: z.object({
        patch: z.string().describe('The unified diff patch to apply'),
    }),
    searchReplace: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        replacement: z
            .string()
            .describe('Replacement string (supports capture groups like $1)'),
        glob: z
            .string()
            .describe("Glob pattern to match files (e.g. 'src/**/*.ts')"),
        flags: z.string().default('g').describe("Regex flags (default: 'g')"),
    }),
    deleteFile: z.object({
        path: z
            .string()
            .describe('Relative path to the file or directory to delete'),
        recursive: z
            .boolean()
            .default(false)
            .describe('Delete directories recursively'),
    }),
    moveFile: z.object({
        from: z
            .string()
            .describe('Relative path of the source file or directory'),
        to: z.string().describe('Relative path of the destination'),
    }),
    createDirectory: z.object({
        path: z.string().describe('Relative path of the directory to create'),
    }),
    runTests: z.object({
        filter: z
            .string()
            .optional()
            .describe('Optional test name filter / file pattern'),
        runner: z
            .string()
            .optional()
            .describe(
                "Test runner to use (e.g. 'bun test', 'npx vitest run', 'npx jest', 'pytest', 'cargo test', 'go test ./...'). Auto-detected if omitted.",
            ),
        timeout: z
            .number()
            .default(60_000)
            .describe('Timeout in milliseconds (default: 60000)'),
    }),
    codeSearch: z.object({
        symbol: z
            .string()
            .describe(
                'Symbol name to search for (function, class, variable, etc.)',
            ),
        path: z.string().default('.').describe('Directory to search from'),
        include: z
            .string()
            .optional()
            .describe("Optional glob to filter files (e.g. '*.ts')"),
    }),
    getOutline: z.object({
        path: z.string().describe('Relative path to the file'),
    }),
    diffFiles: z.object({
        pathA: z.string().describe('Relative path to the first file'),
        pathB: z.string().describe('Relative path to the second file'),
    }),
    httpRequest: z.object({
        url: z.string().url().describe('Full URL to request'),
        method: z
            .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
            .default('GET')
            .describe('HTTP method'),
        headers: z
            .record(z.string(), z.string())
            .optional()
            .describe('Optional request headers'),
        body: z
            .string()
            .optional()
            .describe('Request body (for POST/PUT/PATCH)'),
    }),
    createFile: z.object({
        path: z.string().describe('Relative path to create'),
        content: z.string().describe('File contents'),
    }),
    renameSymbol: z.object({
        oldName: z.string().describe('Current symbol name'),
        newName: z.string().describe('New symbol name'),
        glob: z
            .string()
            .describe("Glob pattern to match files (e.g. 'src/**/*.ts')"),
        dryRun: z
            .boolean()
            .optional()
            .describe('Preview changes without applying (default: false)'),
        fileTypes: z
            .array(z.string())
            .optional()
            .describe("Restrict to file extensions, e.g. ['.ts', '.tsx']"),
    }),
    spawnAgent: z.object({
        task: z
            .string()
            .describe(
                'The full task description for the subagent. Crucial: The subagent does NOT share your chat history or files context automatically, so you must explicitly specify all instructions, relevant file paths, code snippets, dependencies, and expected outputs inside this description.',
            ),
        model: z
            .string()
            .optional()
            .describe(
                'Model ID for the subagent to use. Defaults to the same model as the main agent if omitted.',
            ),
        mode: z
            .enum(['BUILD', 'PLAN'])
            .describe(
                'Mode for the subagent: BUILD (can write files) or PLAN (read-only)',
            ),
    }),
    spawnCodeReviewer: z.object({
        files: z.array(z.string()).describe('Relative file paths to review'),
        focus: z
            .string()
            .optional()
            .describe(
                "Optional focus area, e.g. 'security', 'performance', 'correctness'",
            ),
        model: z
            .string()
            .optional()
            .describe('Model to use. Defaults to same model as main agent.'),
    }),
    spawnTestWriter: z.object({
        files: z
            .array(z.string())
            .describe('Relative file paths to write tests for'),
        testFramework: z
            .string()
            .optional()
            .describe(
                "Test framework to use, e.g. 'vitest', 'jest', 'bun:test'",
            ),
        model: z
            .string()
            .optional()
            .describe('Model to use. Defaults to same model as main agent.'),
    }),
    spawnDebugger: z.object({
        description: z
            .string()
            .describe('Description of the bug or unexpected behaviour'),
        files: z
            .array(z.string())
            .optional()
            .describe('Relevant file paths to investigate'),
        model: z
            .string()
            .optional()
            .describe('Model to use. Defaults to same model as main agent.'),
    }),
    spawnRefactor: z.object({
        files: z.array(z.string()).describe('Relative file paths to refactor'),
        instructions: z
            .string()
            .describe(
                "What to improve, e.g. 'extract duplicated logic', 'simplify error handling'",
            ),
        model: z
            .string()
            .optional()
            .describe('Model to use. Defaults to same model as main agent.'),
    }),
    spawnResearcher: z.object({
        question: z
            .string()
            .describe(
                'The research question or topic to investigate in the codebase',
            ),
        model: z
            .string()
            .optional()
            .describe('Model to use. Defaults to same model as main agent.'),
    }),
    gitCommit: z.object({
        message: z.string().describe('Commit message'),
        files: z
            .array(z.string())
            .optional()
            .describe('Optional file paths to auto-stage before committing'),
    }),
    gitBranch: z.object({
        action: z
            .enum(['create', 'list', 'delete', 'checkout'])
            .describe('Branch operation to perform'),
        name: z
            .string()
            .optional()
            .describe('Branch name (required for create/delete/checkout)'),
    }),
    gitLog: z.object({
        limit: z
            .number()
            .default(20)
            .describe('Maximum number of commits to return (default: 20)'),
        oneline: z
            .boolean()
            .default(true)
            .describe('Show one line per commit (default: true)'),
        author: z.string().optional().describe('Filter commits by author name'),
    }),
    gitBlame: z.object({
        filePath: z.string().describe('Relative path to the file'),
        startLine: z
            .number()
            .optional()
            .describe('Start line number (1-indexed)'),
        endLine: z.number().optional().describe('End line number (1-indexed)'),
    }),
    gitStatusExtended: z.object({}),
    tokenCount: z.object({
        text: z.string().describe('The text to count tokens for'),
    }),
    undo: z.object({}),
    memorySet: z.object({
        key: z
            .string()
            .describe(
                "Memory key (use descriptive names like 'user:tabs' or 'project:db-schema')",
            ),
        value: z.string().describe('Value to store'),
        tags: z
            .array(z.string())
            .optional()
            .describe('Optional tags for categorization'),
    }),
    memoryGet: z.object({
        key: z.string().describe('Memory key to retrieve'),
    }),
    memoryDelete: z.object({
        key: z.string().describe('Memory key to delete'),
    }),
    memoryList: z.object({
        tag: z.string().optional().describe('Optional tag to filter by'),
    }),
    memorySearch: z.object({
        query: z.string().describe('Search query to find matching memories'),
    }),
    envManage: z.object({
        action: z
            .enum(['read', 'list', 'add', 'update', 'delete'])
            .describe('Action to perform on the .env file'),
        key: z
            .string()
            .optional()
            .describe(
                'Environment variable key (required for add/update/delete)',
            ),
        value: z
            .string()
            .optional()
            .describe('Environment variable value (required for add/update)'),
        file: z
            .string()
            .optional()
            .describe('Relative path to the env file (defaults to .env)'),
    }),
    processManage: z.object({
        action: z
            .enum(['list', 'kill', 'list-ports'])
            .describe(
                "Action: 'list' to show dev server processes, 'kill' to stop a process by PID, 'list-ports' to show listening ports",
            ),
        port: z
            .number()
            .optional()
            .describe('Port number to check (for list-ports action)'),
        pid: z
            .number()
            .optional()
            .describe('Process ID to kill (for kill action)'),
        name: z
            .string()
            .optional()
            .describe(
                "Filter processes by name (for list action, e.g. 'node', 'vite')",
            ),
        force: z
            .boolean()
            .default(false)
            .describe(
                'Force kill with SIGKILL instead of SIGTERM (for kill action)',
            ),
    }),
    secretScan: z.object({
        path: z.string().describe('Relative path to scan (file or directory)'),
        recursive: z
            .boolean()
            .default(false)
            .describe('Scan directories recursively (default: false)'),
    }),
    keychainSet: z.object({
        name: z.string().describe('Key name (e.g., "openai-api-key")'),
        value: z.string().describe('Secret value to store'),
    }),
    keychainGet: z.object({
        name: z.string().describe('Key name'),
    }),
    keychainDelete: z.object({
        name: z.string().describe('Key name'),
    }),
    orchestrator: z.object({
        task: z
            .string()
            .describe(
                'High-level task to orchestrate. The orchestrator will decompose this into a DAG of subtasks.',
            ),
        context: z
            .string()
            .optional()
            .describe(
                'Additional context, constraints, or requirements for the task.',
            ),
        strategy: z
            .enum(['balanced', 'speed', 'quality'])
            .default('balanced')
            .describe(
                "Execution strategy: 'balanced' for reasonable parallelism (default), 'speed' for maximum concurrency, 'quality' for thorough review steps.",
            ),
        maxConcurrency: z
            .number()
            .default(5)
            .describe('Maximum number of workers to run in parallel.'),
        maxDurationMs: z
            .number()
            .optional()
            .describe(
                'Max wall-clock ms per worker before timeout (default 300000 = 5 min).',
            ),
    }),
    getTaskStatus: z.object({
        graphId: z
            .string()
            .optional()
            .describe(
                'Task graph ID to check. Omit to see all active orchestrations.',
            ),
    }),
    cancelTask: z.object({
        graphId: z.string().describe('Task graph ID.'),
        taskId: z
            .string()
            .optional()
            .describe(
                'Specific task to cancel. Omit to cancel the entire orchestration.',
            ),
    }),
    taskList: z.object({
        action: z
            .enum(['create', 'update', 'complete', 'remove', 'list'])
            .describe('Action to perform on the task list'),
        tasks: z
            .array(
                z.object({
                    id: z.string().describe('Unique task identifier'),
                    description: z
                        .string()
                        .describe('Concise one-line description of the task'),
                }),
            )
            .optional()
            .describe("Tasks to add (required for 'create' action)"),
        taskId: z
            .string()
            .optional()
            .describe('Task ID to update, complete, or remove'),
        status: z
            .enum(['pending', 'in-progress', 'completed', 'failed'])
            .optional()
            .describe("New status for the task (for 'update' action)"),
    }),
    ai: z.object({
        model: z
            .string()
            .describe(
                "Model ID to use for AI generation. Examples: 'deepseek-ai/deepseek-v4-flash', 'gpt-4o', 'claude-3-5-haiku-20241022', 'opencode/deepseek-v4-flash-free'",
            ),
        messages: z
            .array(
                z.object({
                    role: z
                        .enum(['user', 'assistant', 'system'])
                        .describe('Message role'),
                    content: z.string().describe('Message content'),
                }),
            )
            .describe('Array of messages for the AI model'),
        maxTokens: z
            .number()
            .optional()
            .describe('Maximum number of tokens to generate'),
        temperature: z
            .number()
            .min(0)
            .max(2)
            .optional()
            .describe('Model temperature (0-2, default varies by model)'),
        systemPrompt: z
            .string()
            .optional()
            .describe('Optional system prompt to override the default'),
        stream: z
            .boolean()
            .default(false)
            .describe('Whether to stream the response (experimental)'),
        modelProvider: z
            .string()
            .optional()
            .describe(
                "Optional model provider (e.g., 'nvidia', 'anthropic', 'openai', 'opencode', 'groq'). If omitted, will be inferred from model ID",
            ),
    }),
    askQuestion: z.object({
        questions: z
            .array(
                z.object({
                    question: z
                        .string()
                        .describe('The question to ask the user'),
                    choices: z
                        .array(z.string())
                        .optional()
                        .describe(
                            'Predefined answer choices. If omitted, the user can only type a custom answer.',
                        ),
                    allowCustom: z
                        .boolean()
                        .optional()
                        .default(true)
                        .describe(
                            'Whether the user can type their own answer in addition to choices (default: true)',
                        ),
                }),
            )
            .min(1)
            .max(10)
            .describe('Array of questions to ask the user (1-10 questions)'),
    }),
    useSkill: z.object({
        name: z
            .string()
            .describe(
                'Name of the skill to load (e.g., "graphql", "docker-expert")',
            ),
    }),
    listSkills: z.object({}),
    buildKnowledgeGraph: z.object({
        includePatterns: z
            .array(z.string())
            .optional()
            .describe(
                "Optional file patterns to include (e.g. ['ts', 'tsx', 'json']). If omitted, scans all source files.",
            ),
        excludePatterns: z
            .array(z.string())
            .optional()
            .describe(
                'Optional patterns to exclude (e.g. ["test", "spec", "__mocks__"]).',
            ),
    }),
    queryKnowledgeGraph: z.object({
        nodeType: z
            .enum(['file', 'function', 'class', 'interface', 'type', 'variable', 'module', 'dependency', 'config', 'api'])
            .optional()
            .describe('Filter by node type'),
        name: z
            .string()
            .optional()
            .describe('Search nodes by name (substring match, case-insensitive)'),
        filePath: z
            .string()
            .optional()
            .describe('Filter by file path (substring match)'),
        exported: z
            .boolean()
            .optional()
            .describe('Filter by exported status'),
        limit: z
            .number()
            .default(50)
            .describe('Maximum results to return (default 50)'),
    }),
    getKnowledgeNeighbors: z.object({
        nodeId: z
            .string()
            .describe('ID of the node to find neighbors for'),
        maxDepth: z
            .number()
            .default(1)
            .describe('Maximum traversal depth (default 1, max 5)'),
    }),
    addKnowledgeNode: z.object({
        id: z.string().describe('Unique node ID (e.g. "function:src/utils.ts#helper")'),
        type: z
            .enum(['file', 'function', 'class', 'interface', 'type', 'variable', 'module', 'dependency', 'config', 'api'])
            .describe('Node type'),
        name: z.string().describe('Human-readable name'),
        filePath: z.string().optional().describe('Relative file path'),
        description: z.string().optional().describe('Brief description of this node'),
    }),
    addKnowledgeEdge: z.object({
        source: z.string().describe('Source node ID'),
        target: z.string().describe('Target node ID'),
        type: z
            .enum(['imports', 'exports', 'calls', 'depends-on', 'defines', 'extends', 'implements', 'uses', 'references', 'configures'])
            .describe('Edge type'),
        filePath: z.string().optional().describe('File where this relationship exists'),
    }),
    detectKnowledgeCycles: z.object({}),
    getKnowledgeStats: z.object({}),
    impactAnalysis: z.object({
        nodeId: z
            .string()
            .describe(
                'ID of the node to assess impact for (e.g. "function:src/utils.ts#helper")',
            ),
    }),
    breakingChangeCheck: z.object({
        nodeId: z
            .string()
            .describe('ID of the node whose exports are being modified'),
        keptExports: z
            .array(z.string())
            .describe(
                'List of export names that will be preserved after the change',
            ),
    }),
    suggestMigration: z.object({
        nodeId: z
            .string()
            .describe('ID of the node to generate a migration plan for'),
        newName: z
            .string()
            .optional()
            .describe('New name for the node (if renaming)'),
        newFilePath: z
            .string()
            .optional()
            .describe('New file path for the node (if moving)'),
    }),
} as const;

export const readOnlyToolContracts = {
    readFile: tool({
        description: 'Read a file from the current project directory.',
        inputSchema: toolInputSchemas.readFile,
    }),
    listDirectory: tool({
        description:
            'List entries in a directory under the current project directory.',
        inputSchema: toolInputSchemas.listDirectory,
    }),
    glob: tool({
        description:
            'Find files matching a glob pattern under the current project directory.',
        inputSchema: toolInputSchemas.glob,
    }),
    grep: tool({
        description:
            'Search file contents with a regular expression under the current project directory.',
        inputSchema: toolInputSchemas.grep,
    }),
    tree: tool({
        description: 'Display the directory tree of the project.',
        inputSchema: toolInputSchemas.tree,
    }),
    fileInfo: tool({
        description:
            'Get metadata about a file or directory: size, line count, whether it is a directory, and last modified time.',
        inputSchema: toolInputSchemas.fileInfo,
    }),
    gitStatus: tool({
        description:
            'Show the working tree status (staged, unstaged, and untracked files).',
        inputSchema: toolInputSchemas.gitStatus,
    }),
    gitDiff: tool({
        description: 'Show git diff for the working tree or a specific file.',
        inputSchema: toolInputSchemas.gitDiff,
    }),
    gitCommit: tool({
        description:
            'Stage and commit changes with a message. Optionally auto-stage specific files before committing.',
        inputSchema: toolInputSchemas.gitCommit,
    }),
    gitBranch: tool({
        description: 'Create, list, delete, or checkout git branches.',
        inputSchema: toolInputSchemas.gitBranch,
    }),
    gitLog: tool({
        description:
            'Show recent commit history with optional author filter and oneline format.',
        inputSchema: toolInputSchemas.gitLog,
    }),
    gitBlame: tool({
        description:
            'Show who last modified each line of a file (git blame). Optionally filter to a line range.',
        inputSchema: toolInputSchemas.gitBlame,
    }),
    gitStatusExtended: tool({
        description:
            'Show extended git status including branch tracking info, ahead/behind counts, and stash details.',
        inputSchema: toolInputSchemas.gitStatusExtended,
    }),
    webFetch: tool({
        description: 'Fetch a remote URL and return its body as text.',
        inputSchema: toolInputSchemas.webFetch,
    }),
    codeSearch: tool({
        description:
            'Search for symbol definitions (functions, classes, variables) by name across the codebase.',
        inputSchema: toolInputSchemas.codeSearch,
    }),
    getOutline: tool({
        description:
            'List all top-level symbols (functions, classes, variables, exports) defined in a file.',
        inputSchema: toolInputSchemas.getOutline,
    }),
    diffFiles: tool({
        description: 'Show a unified diff between two files in the project.',
        inputSchema: toolInputSchemas.diffFiles,
    }),
    spawnAgent: tool({
        description:
            'Spawn a subagent to complete a self-contained task in parallel. The subagent runs to completion with its own tool access and returns the result. You must include all necessary file snippets, requirements, and instructions in the task description because subagents do not share your chat history.',
        inputSchema: toolInputSchemas.spawnAgent,
    }),
    spawnResearcher: tool({
        description:
            'Spawn a researcher subagent to explore and summarise a codebase area, architecture question, or dependency. Runs in PLAN (read-only) mode.',
        inputSchema: toolInputSchemas.spawnResearcher,
    }),
    tokenCount: tool({
        description:
            'Count tokens in a text string and estimate API cost. Useful for checking message size before sending or understanding context window usage.',
        inputSchema: toolInputSchemas.tokenCount,
    }),
    memorySet: tool({
        description:
            'Store a value in persistent memory that survives across sessions. Use for user preferences, project context, API keys, or any information you need to remember.',
        inputSchema: toolInputSchemas.memorySet,
    }),
    memoryGet: tool({
        description: 'Retrieve a value from persistent memory by key.',
        inputSchema: toolInputSchemas.memoryGet,
    }),
    memoryDelete: tool({
        description: 'Delete a value from persistent memory by key.',
        inputSchema: toolInputSchemas.memoryDelete,
    }),
    memoryList: tool({
        description:
            'List all stored memory entries, optionally filtered by tag.',
        inputSchema: toolInputSchemas.memoryList,
    }),
    memorySearch: tool({
        description: 'Search memory entries by key or value content.',
        inputSchema: toolInputSchemas.memorySearch,
    }),
    askQuestion: tool({
        description:
            'Ask the user a question with predefined choices or free-text input. Returns the user answers as a string array.',
        inputSchema: toolInputSchemas.askQuestion,
    }),
    useSkill: tool({
        description:
            'Load a skill by name and return its instructions. Skills are specialized guides for common tasks (e.g., "graphql" for GraphQL patterns, "docker-expert" for containerization). Call this when your task matches a known skill domain. The returned content contains step-by-step instructions to follow.',
        inputSchema: toolInputSchemas.useSkill,
    }),
    listSkills: tool({
        description:
            'List all available skills with their names and descriptions. Call this first to discover what skills exist before using useSkill.',
        inputSchema: toolInputSchemas.listSkills,
    }),
    buildKnowledgeGraph: tool({
        description:
            'Scan the project codebase and build a semantic knowledge graph of files, functions, classes, imports, exports, dependencies, and their relationships. Call this first to understand the project architecture. Results are cached locally and can be refreshed.',
        inputSchema: toolInputSchemas.buildKnowledgeGraph,
    }),
    queryKnowledgeGraph: tool({
        description:
            'Search the knowledge graph for nodes matching filters (type, name, file path, exported status). Use to find specific symbols, files, or dependencies in the codebase.',
        inputSchema: toolInputSchemas.queryKnowledgeGraph,
    }),
    getKnowledgeNeighbors: tool({
        description:
            'Get all connected nodes (imports, exports, calls, dependencies) for a given node. Useful for understanding what a file/function depends on and what depends on it.',
        inputSchema: toolInputSchemas.getKnowledgeNeighbors,
    }),
    addKnowledgeNode: tool({
        description:
            'Manually add a node to the knowledge graph for custom relationships not auto-detected.',
        inputSchema: toolInputSchemas.addKnowledgeNode,
    }),
    addKnowledgeEdge: tool({
        description:
            'Manually add an edge (relationship) between two nodes in the knowledge graph.',
        inputSchema: toolInputSchemas.addKnowledgeEdge,
    }),
    detectKnowledgeCycles: tool({
        description:
            'Detect circular dependencies and import cycles in the knowledge graph. Returns arrays of node IDs forming cycles.',
        inputSchema: toolInputSchemas.detectKnowledgeCycles,
    }),
    getKnowledgeStats: tool({
        description:
            'Get summary statistics of the knowledge graph: total nodes/edges, breakdown by type, files scanned, and build metadata.',
        inputSchema: toolInputSchemas.getKnowledgeStats,
    }),
    impactAnalysis: tool({
        description:
            'Analyze the impact of changing a node in the knowledge graph. Returns all direct and transitive consumers, affected files, and a risk level assessment. Use before making breaking changes to understand the blast radius.',
        inputSchema: toolInputSchemas.impactAnalysis,
    }),
    breakingChangeCheck: tool({
        description:
            'Check if modifying a node (removing exports) would break consumers. Compare current exports against a list of exports that will be kept, and get a report of what will break and which files are affected.',
        inputSchema: toolInputSchemas.breakingChangeCheck,
    }),
    suggestMigration: tool({
        description:
            'Generate a step-by-step migration plan for renaming or moving a node. Returns ordered steps with file paths, descriptions, and priorities for each change needed across the codebase.',
        inputSchema: toolInputSchemas.suggestMigration,
    }),
} as const;

export const buildToolContracts = {
    ...readOnlyToolContracts,
    writeFile: tool({
        description:
            'Create or overwrite a file under the current project directory.',
        inputSchema: toolInputSchemas.writeFile,
    }),
    editFile: tool({
        description:
            'Replace exact text in a file under the current project directory. Ensure the oldString matches indentation, spacing, and lines exactly.',
        inputSchema: toolInputSchemas.editFile,
    }),
    bash: tool({
        description: 'Run a shell command in the current project directory.',
        inputSchema: toolInputSchemas.bash,
    }),
    replExecute: tool({
        description: 'Execute a command in the persistent background REPL sandbox session.',
        inputSchema: toolInputSchemas.replExecute,
    }),
    patch: tool({
        description: 'Apply a unified diff patch to the project.',
        inputSchema: toolInputSchemas.patch,
    }),
    searchReplace: tool({
        description:
            'Find and replace text across multiple files using a regex pattern.',
        inputSchema: toolInputSchemas.searchReplace,
    }),
    deleteFile: tool({
        description: 'Delete a file or empty directory from the project.',
        inputSchema: toolInputSchemas.deleteFile,
    }),
    moveFile: tool({
        description: 'Move or rename a file or directory within the project.',
        inputSchema: toolInputSchemas.moveFile,
    }),
    createDirectory: tool({
        description:
            'Create a directory (and any missing parent directories) in the project.',
        inputSchema: toolInputSchemas.createDirectory,
    }),
    runTests: tool({
        description:
            "Run the project's test suite and return structured results.",
        inputSchema: toolInputSchemas.runTests,
    }),
    httpRequest: tool({
        description:
            'Make an HTTP request (GET/POST/PUT/PATCH/DELETE) and return the response.',
        inputSchema: toolInputSchemas.httpRequest,
    }),
    createFile: tool({
        description: 'Create a new file, erroring if it already exists.',
        inputSchema: toolInputSchemas.createFile,
    }),
    renameSymbol: tool({
        description:
            'Rename a variable, function, or class across all matching files. AST-aware: handles declarations, calls, imports, member access, and type annotations while skipping string literals and comments.',
        inputSchema: toolInputSchemas.renameSymbol,
    }),
    spawnCodeReviewer: tool({
        description:
            'Spawn a code reviewer subagent to review files for bugs, security issues, and best practices. Returns a structured review report.',
        inputSchema: toolInputSchemas.spawnCodeReviewer,
    }),
    spawnTestWriter: tool({
        description:
            'Spawn a test writer subagent to write comprehensive unit/integration tests for given files.',
        inputSchema: toolInputSchemas.spawnTestWriter,
    }),
    spawnDebugger: tool({
        description:
            'Spawn a debugger subagent to investigate a bug, trace the root cause, and apply a fix.',
        inputSchema: toolInputSchemas.spawnDebugger,
    }),
    spawnRefactor: tool({
        description:
            'Spawn a refactor subagent to improve code structure, readability, or performance without changing behaviour.',
        inputSchema: toolInputSchemas.spawnRefactor,
    }),
    undo: tool({
        description: 'Undo the last file modification made by the agent.',
        inputSchema: toolInputSchemas.undo,
    }),
    envManage: tool({
        description:
            'Read, add, update, or delete environment variables in .env files. Supports reading raw content, listing parsed variables, and modifying entries while preserving comments and formatting.',
        inputSchema: toolInputSchemas.envManage,
    }),
    processManage: tool({
        description:
            "List and kill dev server processes and port owners. Use to find stuck servers, check what's using a port, or stop runaway processes.",
        inputSchema: toolInputSchemas.processManage,
    }),
    secretScan: tool({
        description:
            'Scan files for secrets, API keys, and credentials before committing. Detects AWS keys, GitHub tokens, database URLs, private keys, passwords, JWT tokens, and more. False positives are possible — review each finding.',
        inputSchema: toolInputSchemas.secretScan,
    }),
    keychainSet: tool({
        description:
            'Store a secret in the OS keychain (macOS Keychain, Linux secret-tool). The secret is encrypted at rest by the OS.',
        inputSchema: toolInputSchemas.keychainSet,
    }),
    keychainGet: tool({
        description: 'Retrieve a secret from the OS keychain by name.',
        inputSchema: toolInputSchemas.keychainGet,
    }),
    keychainDelete: tool({
        description: 'Delete a secret from the OS keychain by name.',
        inputSchema: toolInputSchemas.keychainDelete,
    }),
    orchestrator: tool({
        description:
            "Orchestrate a complex task by decomposing it into a DAG of subtasks and running specialized worker agents in parallel. Use for multi-step work that benefits from concurrent execution (e.g., 'review file A, write tests for file B, and research best practices for X').",
        inputSchema: toolInputSchemas.orchestrator,
    }),
    getTaskStatus: tool({
        description:
            'Check the status of running or completed task orchestration graphs. Shows progress, individual task states, and results.',
        inputSchema: toolInputSchemas.getTaskStatus,
    }),
    cancelTask: tool({
        description:
            'Cancel a running orchestration or individual task. Running tasks will be aborted, pending tasks cancelled.',
        inputSchema: toolInputSchemas.cancelTask,
    }),
    taskList: tool({
        description:
            "Manage a visible task checklist. Use for complex multi-step work (3+ steps) to create a plan, track progress, and show status. Call with action='create' and a tasks array to start, then 'update'/'complete' as you work through them.",
        inputSchema: toolInputSchemas.taskList,
    }),
} as const;

export type ToolContracts = typeof buildToolContracts;

export function getToolContracts(mode: ModeType) {
    return mode === Mode.PLAN ? readOnlyToolContracts : buildToolContracts;
}

/**
 * Tools that subagents should NOT receive.
 * Subagents are leaf workers — they must not spawn children, orchestrate, or manage undo state.
 */
const SUBAGENT_EXCLUDED_TOOLS = new Set([
    'spawnAgent',
    'spawnCodeReviewer',
    'spawnTestWriter',
    'spawnDebugger',
    'spawnRefactor',
    'spawnResearcher',
    'orchestrator',
    'getTaskStatus',
    'cancelTask',
    'undo',
]);

/**
 * Filtered tool contracts for subagent requests.
 * Removes spawn/orchestration/undo tools that subagents cannot use, saving ~200 tokens per request.
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
