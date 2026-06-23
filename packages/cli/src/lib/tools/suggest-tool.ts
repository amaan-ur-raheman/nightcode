/**
 * Tool Discovery System
 *
 * Helps the model find the right tool by describing what it wants to do.
 * Categorizes tools by task type and returns the best suggestions with
 * usage examples. Solves the "50+ tools, which one do I need?" problem.
 */

import { toolInputSchemas } from '@nightcode/shared';

const TOOL_CATEGORIES: Record<
    string,
    {
        description: string;
        tools: Array<{
            name: string;
            when: string;
            example?: string;
        }>;
    }
> = {
    'read-explore': {
        description: 'Reading and exploring code',
        tools: [
            {
                name: 'readFile',
                when: 'Read file contents',
                example: 'readFile({ path: "src/index.ts" })',
            },
            {
                name: 'glob',
                when: 'Find files by pattern (e.g. all .ts files)',
                example: 'glob({ pattern: "src/**/*.ts" })',
            },
            {
                name: 'grep',
                when: 'Search file contents with regex',
                example:
                    'grep({ pattern: "function.*authenticate", include: "*.ts" })',
            },
            {
                name: 'codeSearch',
                when: 'Search for symbol definitions by name',
                example: 'codeSearch({ symbol: "UserService" })',
            },
            {
                name: 'getOutline',
                when: 'List top-level symbols in a file without reading it all',
                example: 'getOutline({ path: "src/auth.ts" })',
            },
            {
                name: 'listDirectory',
                when: 'List directory contents',
                example: 'listDirectory({ path: "src/" })',
            },
            {
                name: 'tree',
                when: 'Show project directory tree',
                example: 'tree({ depth: 3 })',
            },
            {
                name: 'fileInfo',
                when: 'Get file metadata (size, lines, type)',
                example: 'fileInfo({ path: "src/index.ts" })',
            },
            {
                name: 'diffFiles',
                when: 'Compare two files side-by-side',
                example: 'diffFiles({ pathA: "a.ts", pathB: "b.ts" })',
            },
        ],
    },
    'write-edit': {
        description: 'Writing and editing code',
        tools: [
            {
                name: 'editFile',
                when: 'Targeted string replacement in a file (most common)',
                example:
                    'editFile({ path: "src/index.ts", oldString: "old code", newString: "new code" })',
            },
            {
                name: 'writeFile',
                when: 'Create a new file or completely rewrite a file',
                example: 'writeFile({ path: "src/new.ts", content: "..." })',
            },
            {
                name: 'patch',
                when: 'Apply a unified diff patch (multiple hunk edits)',
            },
            {
                name: 'searchReplace',
                when: 'Bulk regex replacement across multiple files',
                example:
                    'searchReplace({ pattern: "foo", replacement: "bar", glob: "src/**/*.ts" })',
            },
            {
                name: 'renameSymbol',
                when: 'AST-aware rename of functions/classes/variables across files',
                example:
                    'renameSymbol({ oldName: "oldFn", newName: "newFn", glob: "src/**/*.ts" })',
            },
            {
                name: 'moveFile',
                when: 'Move or rename a file (updates imports automatically)',
            },
            {
                name: 'deleteFile',
                when: 'Delete a file or empty directory',
            },
            {
                name: 'createDirectory',
                when: 'Create a directory (with parents)',
            },
        ],
    },
    git: {
        description: 'Git operations',
        tools: [
            {
                name: 'gitStatus',
                when: 'See staged/unstaged/untracked files',
            },
            {
                name: 'gitDiff',
                when: 'View code changes',
            },
            {
                name: 'gitCommit',
                when: 'Stage and commit changes',
            },
            {
                name: 'gitLog',
                when: 'View commit history',
            },
            {
                name: 'gitBlame',
                when: 'See who last modified each line',
            },
            {
                name: 'gitBranch',
                when: 'Create/list/delete/checkout branches',
            },
            {
                name: 'gitOperations',
                when: 'Merge, stash, push, pull, fetch',
            },
            {
                name: 'gitStatusExtended',
                when: 'Extended status (tracking, ahead/behind, stash)',
            },
        ],
    },
    validate: {
        description: 'Validation and verification',
        tools: [
            {
                name: 'validateCode',
                when: 'Run typecheck, lint, and/or tests',
                example:
                    'validateCode({ typecheck: true, lint: true, test: true })',
            },
            {
                name: 'secretScan',
                when: 'Scan for accidentally committed secrets',
            },
            {
                name: 'checkExternalChanges',
                when: 'Detect files modified outside this session',
            },
            {
                name: 'profileCode',
                when: 'Run benchmarks and profile performance',
            },
        ],
    },
    delegate: {
        description: 'Delegating work to subagents',
        tools: [
            {
                name: 'spawnAgent',
                when: 'General-purpose subagent for a self-contained task',
            },
            {
                name: 'spawnResearcher',
                when: 'Research a codebase question (PLAN/read-only mode)',
            },
            {
                name: 'spawnCodeReviewer',
                when: 'Review files for bugs and security issues',
            },
            {
                name: 'spawnTestWriter',
                when: 'Write tests for given files',
            },
            {
                name: 'spawnDebugger',
                when: 'Investigate and fix a bug',
            },
            {
                name: 'spawnRefactor',
                when: 'Refactor code without changing behavior',
            },
            {
                name: 'orchestrator',
                when: 'Multi-step DAG execution with parallel roles',
            },
        ],
    },
    knowledge: {
        description: 'Codebase intelligence and analysis',
        tools: [
            {
                name: 'buildKnowledgeGraph',
                when: 'Scan and build a semantic knowledge graph',
            },
            {
                name: 'queryKnowledgeGraph',
                when: 'Find nodes by type, name, or file path',
            },
            {
                name: 'getKnowledgeNeighbors',
                when: 'Trace connected nodes (imports, exports, calls)',
            },
            {
                name: 'impactAnalysis',
                when: 'See all consumers of a symbol before changing it',
            },
            {
                name: 'breakingChangeCheck',
                when: 'Check if removing exports breaks consumers',
            },
            {
                name: 'suggestMigration',
                when: 'Generate a migration plan for renaming/moving',
            },
            {
                name: 'semanticSearch',
                when: 'Symbol-level search by name or concept',
            },
        ],
    },
    memory: {
        description: 'Persistent memory and secrets',
        tools: [
            {
                name: 'memorySet',
                when: 'Store a value that survives across sessions',
            },
            {
                name: 'memoryGet',
                when: 'Retrieve a stored value',
            },
            {
                name: 'memorySearch',
                when: 'Search memory entries',
            },
            {
                name: 'memoryFuzzySearch',
                when: 'Fuzzy search (tolerates typos)',
            },
            {
                name: 'keychainSet',
                when: 'Store a secret in the OS keychain (encrypted)',
            },
            {
                name: 'keychainGet',
                when: 'Retrieve a secret from the OS keychain',
            },
        ],
    },
    utility: {
        description: 'Utility and misc tools',
        tools: [
            {
                name: 'bash',
                when: 'Run any shell command',
            },
            {
                name: 'replExecute',
                when: 'Run code in a persistent REPL (state survives)',
            },
            {
                name: 'webFetch',
                when: 'Fetch a URL and read its content',
            },
            {
                name: 'tokenCount',
                when: 'Count tokens in text',
            },
            {
                name: 'undo',
                when: 'Revert the last file modification',
            },
            {
                name: 'taskList',
                when: 'Manage a visible task checklist',
            },
            {
                name: 'askQuestion',
                when: 'Ask the user a question with choices',
            },
            {
                name: 'useSkill',
                when: 'Load a specialized guide (e.g. "graphql", "docker")',
            },
            {
                name: 'envManage',
                when: 'Read/update .env files',
            },
            {
                name: 'processManage',
                when: 'List/kill dev server processes',
            },
            {
                name: 'packageManager',
                when: 'Install/update/remove packages',
            },
            {
                name: 'reviewPr',
                when: 'Review a GitHub PR by URL',
            },
        ],
    },
};

export interface ToolSuggestion {
    category: string;
    name: string;
    when: string;
    example?: string;
    relevance: 'exact' | 'related';
}

/**
 * Score a tool's relevance to a task description.
 * Returns a score from 0 (irrelevant) to 1 (exact match).
 */
function scoreRelevance(toolName: string, when: string, task: string): number {
    const taskLower = task.toLowerCase();
    const nameLower = toolName.toLowerCase();
    const whenLower = when.toLowerCase();

    // Exact tool name mentioned
    if (taskLower.includes(nameLower)) return 1.0;

    // Keyword matching
    const keywords = whenLower.split(/[\s,;.]+/).filter((w) => w.length > 3);
    let matches = 0;
    for (const kw of keywords) {
        if (taskLower.includes(kw)) matches++;
    }
    return keywords.length > 0 ? matches / keywords.length : 0;
}

export async function suggestToolTool(
    input: unknown,
): Promise<{ suggestions: ToolSuggestion[]; categories: string[] }> {
    const { task, category } = toolInputSchemas.suggestTool.parse(input);

    const categories = Object.keys(TOOL_CATEGORIES);
    const results: ToolSuggestion[] = [];

    // If a specific category is requested, filter to it
    const catsToSearch = category
        ? categories.filter((c) => c === category)
        : categories;

    for (const cat of catsToSearch) {
        const catData = TOOL_CATEGORIES[cat];
        if (!catData) continue;

        for (const t of catData.tools) {
            const score = scoreRelevance(t.name, t.when, task);
            if (score > 0) {
                results.push({
                    category: cat,
                    name: t.name,
                    when: t.when,
                    example: t.example,
                    relevance: score >= 0.8 ? 'exact' : 'related',
                });
            }
        }
    }

    // Sort by relevance score (highest first), limit to top 8
    results.sort((a, b) => {
        const scoreA = a.relevance === 'exact' ? 1 : 0.5;
        const scoreB = b.relevance === 'exact' ? 1 : 0.5;
        return scoreB - scoreA;
    });

    return {
        suggestions: results.slice(0, 8),
        categories: catsToSearch,
    };
}

export async function listToolCategoriesTool(_input: unknown): Promise<{
    categories: Array<{ name: string; description: string; toolCount: number }>;
}> {
    return {
        categories: Object.entries(TOOL_CATEGORIES).map(([name, data]) => ({
            name,
            description: data.description,
            toolCount: data.tools.length,
        })),
    };
}
