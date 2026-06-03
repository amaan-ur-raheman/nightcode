import { z } from "zod";
import { tool } from "ai";

export const Mode = {
    BUILD: "BUILD",
    PLAN: "PLAN",
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);

export type ModeType = (typeof Mode)[keyof typeof Mode];

export const toolInputSchemas = {
    readFile: z.object({
        path: z.string().describe("Relative path to the file to read"),
        offset: z.number().optional().describe("Line number to start reading from (1-indexed, optional)"),
        limit: z.number().optional().describe("Number of lines to return (optional)"),
    }),
    listDirectory: z.object({
        path: z.string().default(".").describe("Relative directory path to list"),
    }),
    glob: z.object({
        pattern: z.string().describe("Glob pattern to match files"),
        path: z.string().default(".").describe("Directory to search from"),
    }),
    grep: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().default(".").describe("Directory to search from"),
        include: z.string().optional().describe("Optional glob for files to include"),
    }),
    tree: z.object({
        path: z.string().default(".").describe("Relative path to start from"),
        depth: z.number().default(3).describe("Maximum depth to traverse (default: 3)"),
    }),
    fileInfo: z.object({
        path: z.string().describe("Relative path to the file or directory"),
    }),
    gitStatus: z.object({}),
    gitDiff: z.object({
        path: z.string().optional().describe("Relative path to a specific file (optional, omit for full diff)"),
        staged: z.boolean().default(false).describe("Show staged (cached) diff instead of unstaged"),
    }),
    webFetch: z.object({
        url: z.string().url().describe("Full URL to fetch"),
        headers: z.record(z.string(), z.string()).optional().describe("Optional HTTP request headers"),
    }),
    writeFile: z.object({
        path: z.string().describe("Relative path to write"),
        content: z.string().describe("File contents"),
    }),
    editFile: z.object({
        path: z.string().describe("Relative path to edit"),
        oldString: z.string().describe("Exact text to replace; must be unique"),
        newString: z.string().describe("Replacement text"),
    }),
    bash: z.object({
        command: z.string().describe("Shell command to run"),
        timeout: z.number().default(30_000).describe("Timeout in milliseconds (default: 30000)"),
    }),
    patch: z.object({
        patch: z.string().describe("The unified diff patch to apply"),
    }),
    searchReplace: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        replacement: z.string().describe("Replacement string (supports capture groups like $1)"),
        glob: z.string().describe("Glob pattern to match files (e.g. 'src/**/*.ts')"),
        flags: z.string().default("g").describe("Regex flags (default: 'g')"),
    }),
    deleteFile: z.object({
        path: z.string().describe("Relative path to the file or directory to delete"),
        recursive: z.boolean().default(false).describe("Delete directories recursively"),
    }),
    moveFile: z.object({
        from: z.string().describe("Relative path of the source file or directory"),
        to: z.string().describe("Relative path of the destination"),
    }),
    createDirectory: z.object({
        path: z.string().describe("Relative path of the directory to create"),
    }),
    runTests: z.object({
        filter: z.string().optional().describe("Optional test name filter / file pattern"),
        timeout: z.number().default(60_000).describe("Timeout in milliseconds (default: 60000)"),
    }),
    codeSearch: z.object({
        symbol: z.string().describe("Symbol name to search for (function, class, variable, etc.)"),
        path: z.string().default(".").describe("Directory to search from"),
        include: z.string().optional().describe("Optional glob to filter files (e.g. '*.ts')"),
    }),
    getOutline: z.object({
        path: z.string().describe("Relative path to the file"),
    }),
    diffFiles: z.object({
        pathA: z.string().describe("Relative path to the first file"),
        pathB: z.string().describe("Relative path to the second file"),
    }),
    httpRequest: z.object({
        url: z.string().url().describe("Full URL to request"),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET").describe("HTTP method"),
        headers: z.record(z.string(), z.string()).optional().describe("Optional request headers"),
        body: z.string().optional().describe("Request body (for POST/PUT/PATCH)"),
    }),
    createFile: z.object({
        path: z.string().describe("Relative path to create"),
        content: z.string().describe("File contents"),
    }),
    renameSymbol: z.object({
        oldName: z.string().describe("Current symbol name"),
        newName: z.string().describe("New symbol name"),
        glob: z.string().describe("Glob pattern to match files (e.g. 'src/**/*.ts')"),
    }),
} as const;

export const readOnlyToolContracts = {
    readFile: tool({
        description: "Read a file from the current project directory.",
        inputSchema: toolInputSchemas.readFile,
    }),
    listDirectory: tool({
        description: "List entries in a directory under the current project directory.",
        inputSchema: toolInputSchemas.listDirectory,
    }),
    glob: tool({
        description: "Find files matching a glob pattern under the current project directory.",
        inputSchema: toolInputSchemas.glob,
    }),
    grep: tool({
        description: "Search file contents with a regular expression under the current project directory.",
        inputSchema: toolInputSchemas.grep,
    }),
    tree: tool({
        description: "Display the directory tree of the project.",
        inputSchema: toolInputSchemas.tree,
    }),
    fileInfo: tool({
        description: "Get metadata about a file or directory: size, line count, whether it is a directory, and last modified time.",
        inputSchema: toolInputSchemas.fileInfo,
    }),
    gitStatus: tool({
        description: "Show the working tree status (staged, unstaged, and untracked files).",
        inputSchema: toolInputSchemas.gitStatus,
    }),
    gitDiff: tool({
        description: "Show git diff for the working tree or a specific file.",
        inputSchema: toolInputSchemas.gitDiff,
    }),
    webFetch: tool({
        description: "Fetch a remote URL and return its body as text.",
        inputSchema: toolInputSchemas.webFetch,
    }),
    codeSearch: tool({
        description: "Search for symbol definitions (functions, classes, variables) by name across the codebase.",
        inputSchema: toolInputSchemas.codeSearch,
    }),
    getOutline: tool({
        description: "List all top-level symbols (functions, classes, variables, exports) defined in a file.",
        inputSchema: toolInputSchemas.getOutline,
    }),
    diffFiles: tool({
        description: "Show a unified diff between two files in the project.",
        inputSchema: toolInputSchemas.diffFiles,
    }),
} as const;

export const buildToolContracts = {
    ...readOnlyToolContracts,
    writeFile: tool({
        description: "Create or overwrite a file under the current project directory.",
        inputSchema: toolInputSchemas.writeFile,
    }),
    editFile: tool({
        description: "Replace exact text in a file under the current project directory.",
        inputSchema: toolInputSchemas.editFile,
    }),
    bash: tool({
        description: "Run a shell command in the current project directory.",
        inputSchema: toolInputSchemas.bash,
    }),
    patch: tool({
        description: "Apply a unified diff patch to the project.",
        inputSchema: toolInputSchemas.patch,
    }),
    searchReplace: tool({
        description: "Find and replace text across multiple files using a regex pattern.",
        inputSchema: toolInputSchemas.searchReplace,
    }),
    deleteFile: tool({
        description: "Delete a file or empty directory from the project.",
        inputSchema: toolInputSchemas.deleteFile,
    }),
    moveFile: tool({
        description: "Move or rename a file or directory within the project.",
        inputSchema: toolInputSchemas.moveFile,
    }),
    createDirectory: tool({
        description: "Create a directory (and any missing parent directories) in the project.",
        inputSchema: toolInputSchemas.createDirectory,
    }),
    runTests: tool({
        description: "Run the project's test suite and return structured results.",
        inputSchema: toolInputSchemas.runTests,
    }),
    httpRequest: tool({
        description: "Make an HTTP request (GET/POST/PUT/PATCH/DELETE) and return the response.",
        inputSchema: toolInputSchemas.httpRequest,
    }),
    createFile: tool({
        description: "Create a new file, erroring if it already exists.",
        inputSchema: toolInputSchemas.createFile,
    }),
    renameSymbol: tool({
        description: "Rename a symbol across all matching files using word-boundary matching.",
        inputSchema: toolInputSchemas.renameSymbol,
    }),
} as const;

export type ToolContracts = typeof buildToolContracts;

export function getToolContracts(mode: ModeType) {
    return mode === Mode.PLAN
        ? readOnlyToolContracts
        : buildToolContracts;
}
