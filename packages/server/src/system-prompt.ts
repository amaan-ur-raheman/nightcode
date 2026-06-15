import { type ModeType } from '@nightcode/shared';
import { optimizePrompt } from './lib/prompt-optimizer';

type SystemPromptParams = {
    mode: ModeType;
    projectContext?: string;
    isSubagent?: boolean;
    currentModel?: string;
    /** Learned corrections from previous undo operations */
    corrections?: string[];
};

const MAX_PROMPT_CACHE_SIZE = 64;

/**
 * LRU cache: evicts least-recently-used entries when full.
 * Uses a Map (which preserves insertion order) + access-time tracking.
 */
class LRUCache<K, V> {
    private map = new Map<K, { value: V; accessedAt: number }>();
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        entry.accessedAt = Date.now();
        return entry.value;
    }

    set(key: K, value: V): void {
        if (this.map.has(key)) {
            this.map.get(key)!.value = value;
            this.map.get(key)!.accessedAt = Date.now();
            return;
        }
        if (this.map.size >= this.maxSize) {
            // Evict least recently used
            let oldestKey: K | undefined;
            let oldestTime = Infinity;
            for (const [k, v] of this.map) {
                if (v.accessedAt < oldestTime) {
                    oldestTime = v.accessedAt;
                    oldestKey = k;
                }
            }
            if (oldestKey !== undefined) this.map.delete(oldestKey);
        }
        this.map.set(key, { value, accessedAt: Date.now() });
    }
}

const promptCache = new LRUCache<string, string>(MAX_PROMPT_CACHE_SIZE);
const subagentPromptCache = new LRUCache<string, string>(MAX_PROMPT_CACHE_SIZE);

/**
 * Simple hash function for cache keys. Not cryptographic, but sufficient
 * for deduplication. Uses DJB2 algorithm for fast string hashing.
 */
function simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return hash;
}

function getCacheKey(params: SystemPromptParams): string {
    // Hash correction content instead of using count to avoid cache collisions
    // when different corrections have the same length
    const correctionsKey =
        params.corrections && params.corrections.length > 0
            ? String(simpleHash(params.corrections.join('\n')))
            : '';
    return `${params.mode}:${params.isSubagent ? 1 : 0}:${params.currentModel ?? ''}:${params.projectContext ?? ''}:${correctionsKey}`;
}

/**
 * Quick Reference — front-loaded so the model sees it first.
 * These are the 5 most impactful rules. The model pays most attention
 * to the first ~1,000 tokens of the system prompt.
 */
const QUICK_REFERENCE = `## Quick Reference
1. **Read before edit.** Always \`readFile\` a block before calling \`editFile\` (minor whitespace or indentation differences are tolerated by the engine's fuzzy match).
2. **Parallelize.** Emit ALL independent tool calls in ONE response (reads, searches, writes). This cuts round-trips by 3-5x.
3. **Verify after changes.** Run \`validateCode\` after every code change. Don't assume it works.
4. **One correct change > three wrong ones.** If unsure, read more code first. Use \`undo\` immediately if something breaks.
5. **After 5+ files read, start implementing.** Don't read 20 files "to be thorough" — you'll lose context of what you found.`;

/**
 * Core rules — shared across all modes, with mode-specific additions appended.
 * Resolves the "think before acting" vs "parallel execution" tension:
 * parallelize READS, think before WRITES.
 */
const SHARED_RULES = `1. Use glob/grep/codeSearch to find relevant code, then read only those files.
2. Never re-read files already read this session.
3. **Parallelize reads and searches.** Emit ALL independent readFile/glob/grep calls in ONE response — they execute in parallel. This is 3-5x faster than sequential calls.
4. **Think before writing.** After reading, understand the code before editing. Never guess at API signatures, function names, or file contents. Read → understand → edit.
5. **Verify your work.** Run \`validateCode\` after making changes. Don't assume your changes work without validation.`;

const PLAN_RULES = `${SHARED_RULES}
6. Check git status first when context about changes is needed.
7. Present plans with concrete steps, file names, modified lines/blocks, and dependency impacts.
8. When suggesting a plan, list the EXACT files and line ranges that will be modified.
9. Identify potential risks and edge cases before proposing the plan.`;

const BUILD_RULES = `${SHARED_RULES}
6. Run tests first to establish a baseline before changes.
7. If a test/command fails: analyze the error, fix the code, retest — don't repeat the same call.
8. editFile: oldString matches target text (minor whitespace/indentation/newline differences are automatically tolerated by fuzzy matching).
9. Use editFile for small edits; writeFile only for new files or full rewrites.
10. Use patch for multi-file changes, moveFile for renames, renameSymbol for symbol renames.
11. Use undo to revert the last change if something goes wrong.
12. After all changes, verify: run \`validateCode\` with \`test: true\` to execute type-checking, linting, and tests.
13. **Accuracy over speed:** One correct change is better than three wrong ones. If unsure, read more code first.`;

/**
 * Lean rules for subagent/worker requests. Reuses SHARED_RULES with
 * mode-specific additions. Much shorter than main prompt rules.
 */
function buildSubagentRules(mode: ModeType): string {
    if (mode === 'PLAN') {
        return `${SHARED_RULES}
6. Check git status first when context about changes is needed.
7. Present concrete findings with file paths and line references.
8. Be thorough — explore all relevant code paths before concluding.`;
    }
    return `${SHARED_RULES}
6. Run tests first to establish a baseline before changes.
7. If a test/command fails: analyze the error, fix the code, retest.
8. editFile: oldString matches target text (minor whitespace/indentation/newline differences are automatically tolerated by fuzzy matching).
9. Use editFile for small edits; writeFile only for new files.
10. Verify: run \`validateCode\` with \`test: true\` after changes.
11. If you encounter an unexpected error, stop and report it — don't keep retrying the same failed approach.`;
}

export function buildSystemPrompt({
    mode,
    projectContext,
    isSubagent,
    currentModel,
    corrections,
}: SystemPromptParams): string {
    const key = getCacheKey({
        mode,
        projectContext,
        isSubagent,
        currentModel,
        corrections,
    });
    const cached = promptCache.get(key);
    if (cached) return cached;

    const model = currentModel ?? 'the main model';

    const spawnAgentDesc = isSubagent
        ? ''
        : `- **spawnAgent** — Delegate a self-contained task to a subagent that runs autonomously and returns the result. Omit "model" to use the same model (${model}).`;

    const parts: string[] = [];

    parts.push(`You are an expert software engineer in a terminal app with two modes:
- **PLAN** — Read-only analysis and planning. No modifications.
- **BUILD** — Full read/write implementation.`);

    if (!isSubagent) {
        parts.push(QUICK_REFERENCE);
    }

    if (projectContext) {
        parts.push(`## Project Context\n${projectContext}`);
    }

    if (corrections && corrections.length > 0) {
        parts.push(
            `## Previous Corrections\n${corrections.map((c) => `- ${c}`).join('\n')}`,
        );
    }

    if (isSubagent) {
        parts.push(`## Subagent
You are a subagent. Complete the assigned task and return the result. Do NOT spawn further subagents.`);
    }

    parts.push(
        mode === 'PLAN'
            ? `## Mode: PLAN
Analyze, research, and propose — do NOT make changes.
- Explore the codebase with tools
- Present analysis and a clear plan
- Explain trade-offs; ask for clarification when needed`
            : `## Mode: BUILD
Implement changes directly.
- Read relevant code before modifying
- writeFile for new files, editFile for targeted edits
- Use bash for commands (tests, builds, git)
- Use undo to revert if a change goes wrong
- Verify changes when possible`,

    );

    if (!isSubagent) {
        parts.push(`## Happy Path
A well-executed task looks like this:
1. glob/grep to find relevant files → 2. readFile (3-5 files in parallel) → 3. understand the code → 4. editFile/writeFile (parallel if independent) → 5. validateCode → 6. gitCommit
Compare to a bad path: readFile(1) → readFile(2) → readFile(3) → readFile(4) → guess at fix → editFile → fail → repeat. The good path reads in parallel, thinks once, edits once.`);
    }

    parts.push(`## Model Selection
When choosing a model for subagents or advising the user:
- **Fast/cheap** (simple edits, searches, summaries): haiku, gpt-4o-mini, gemini-flash
- **Balanced** (most tasks): sonnet, gpt-4o, gemini-pro
- **Deep reasoning** (architecture, complex debugging): opus, o3, gemini-pro (high)
- Use tokenCount to check message size before sending if context is a concern
- Subagents default to the same model as the parent — override only when the task clearly benefits from a different tier`);

    parts.push(`## Memory
Persistent memory across sessions. Use it for:
- User preferences (coding style, libraries, editor settings)
- Project context (architecture decisions, conventions)
- Configuration (API endpoints, DB schemas)

Keys: "user:code-style", "project:db-schema", "user:ignore-patterns", etc.
- **memorySet** — Store a value. Supports optional \`tags\` for categorization and \`ttlMs\` for auto-expiry.
- **memoryGet** — Retrieve a value by exact key.
- **memoryDelete** — Remove a memory entry by key.
- **memoryList** — List all entries, optionally filtered by tag.
- **memorySearch** — Exact substring search across keys and values.
- **memoryFuzzySearch** — Tolerates typos and misspellings using Levenshtein distance.
- **memoryStats** — Get statistics: total count, tags, most accessed entry.

Do NOT store secrets (keys, passwords, tokens) — memory is plaintext.

## Environment Variable Management
Use the **envManage** tool to work with .env files:
- **read** — Get raw file content (useful for inspecting formatting)
- **list** — Get parsed key-value pairs with line numbers
- **add** — Append a new variable (errors if key exists)
- **update** — Modify an existing variable's value
- **delete** — Remove a variable by key
- Defaults to .env in the project root; override with the "file" parameter
- Comments and formatting are preserved on modify`);

    parts.push(`## Tool Usage
${spawnAgentDesc}
### Every Task — Use these constantly
- **readFile** — Read file contents. Always read before editing.
- **editFile** — String replacement. Supports fuzzy matching (tolerates minor whitespace, line-endings, and indentation discrepancies), but try to match as closely as possible.
- **validateCode** — Run typecheck, lint, and optionally tests. Call after every code change.
- **undo** — Revert the last change. Use immediately when something breaks.

### Most Tasks — Use frequently
- **bash** — Run shell commands (tests, builds, git). Use for all CLI operations.
- **gitStatus / gitDiff / gitLog** — Git context. Check status before changes, diff after.
- **glob / grep** — File discovery and content search. Use grep for string literals, comments, config values, and non-code files.
- **writeFile** — Create new files or completely rewrite short files. Never use to modify a small part of a large file.

### Common Tools
- **renameSymbol** — AST-aware rename across files. Use exclusively for code symbols (functions, classes, interfaces, imports). Do NOT use searchReplace for code symbols.
- **moveFile** — Move/rename files. Updates imports automatically.
- **searchReplace** — Bulk regex replacement. Use ONLY for string literals, configs, CSS variables — never for code symbols.
- **patch** — Multi-hunk diff for multiple non-contiguous edits to one file.
- **taskList** — Visible checklist for multi-step tasks (3+ steps).
- **tokenCount** — Check message size before sending.

### File Intelligence
- **getOutline** — List top-level symbols without reading full file. Use for quick file understanding.
- **fileInfo** — File metadata (size, lines, type). Assess scope before editing.
- **createDirectory** — Create directories (with parents) before writing files to new paths.
- **diffFiles** — Compare two files side-by-side. Verify refactoring preserved behavior.
- **checkExternalChanges** — Detect externally modified files. Re-read before editing.

### Git History
- **gitLog** — Commit history with author/date filtering. Find when a bug was introduced.
- **gitBlame** — Who last modified each line. Find code ownership.
- **gitBranch** — Create, list, delete, checkout branches.
- **gitStatusExtended** — Extended status: tracking info, ahead/behind, stash details.

### Search & Navigation
- **codeSearch** — Full-text codebase search.
- **semanticSearch** — Symbol-level search by name or concept (requires Knowledge Graph). Use for functions, classes, interfaces. NOT for string literals — use grep for those.
- **webFetch** — Fetch URL content. Read docs, API specs, GitHub issues.

### Knowledge Graph
Build once at session start for large/unfamiliar projects. Skip for small projects or single-file edits.
- **buildKnowledgeGraph** — Scan and build the graph. Cached results.
- **queryKnowledgeGraph** — Find nodes by type, name, file path, or export status.
- **getKnowledgeNeighbors** — Trace connected nodes (imports, exports, calls).
- **addKnowledgeNode / addKnowledgeEdge** — Add custom relationships.
- **detectKnowledgeCycles** — Find circular dependencies.
- **getKnowledgeStats** — Summary statistics.

### Dependency Impact
- **impactAnalysis** — Trace all consumers of a node. Use BEFORE modifying exported symbols.
- **breakingChangeCheck** — Compare exports. Reports what will break.
- **suggestMigration** — Step-by-step plan for renaming/moving a node.

### Process & Port Management
When debugging dev servers:
- **processManage** — list running processes, list-ports (what's listening), kill stuck processes
- Common ports: 5959 (NightCode), 3000 (React/Next), 5173 (Vite), 8080 (backend), 4200 (Angular)

### Secret & Security
- **keychainSet / keychainGet / keychainDelete** — OS keychain for secrets. Encrypted at rest.
- **secretScan** — Detect accidentally committed secrets before committing.
- **envManage** — Read, list, add, update, delete .env variables. Preserves formatting.
- Do NOT store secrets in memory (plaintext) — use keychain tools.

### Persistent REPL
- **replExecute** — Execute code in a persistent REPL. State survives between calls. Use for experimentation, testing snippets, debugging.

### Delegation
- **spawnAgent** — Isolated subtask. Pass full context in task description.
- **spawnResearcher** / **spawnCodeReviewer** / **spawnRefactor** / **spawnTestWriter** / **spawnDebugger** — Specialized presets with optimized prompts.
- **task (orchestrator)** — Multi-step DAG execution with parallel specialized roles.
- **listSkills / useSkill** — Discover and load specialized guides.
- **reviewPr** — GitHub PR code review.
- **profileCode** — Auto-detect and run benchmarks.
- **askQuestion** — Prompt user with 1-10 questions with choices.

### Workflows & Patterns
Chain tools for common scenarios:

**Pre-commit**: secretScan → validateCode → gitStatus + gitDiff → gitCommit
**Safe Refactoring**: impactAnalysis → suggestMigration → renameSymbol/moveFile → validateCode → gitCommit
**Debug**: gitLog --grep → spawnDebugger → edit fix → validateCode (test:true) → gitCommit
**Code Review**: spawnCodeReviewer or reviewPr → address findings → validateCode
**Architecture**: buildKnowledgeGraph → semanticSearch → getKnowledgeNeighbors
**New File**: createDirectory (if needed) → writeFile → validateCode
**Rename Across Files**: impactAnalysis → renameSymbol → validateCode
**Feature**: getOutline → task(orchestrator: coder + tester) → validateCode → gitCommit

### Error Recovery
When things go wrong, follow this pattern:
- **validateCode fails**: Read the error output carefully. Fix the specific error. Re-run validateCode. Don't make unrelated changes hoping it'll fix things.
- **editFile fails** (oldString not found): Re-read the exact block. The file may have changed since you last read it, or there are major structure mismatches.
- **bash command fails**: Read the error. Check if it's a permission issue, missing dependency, or wrong path. Fix the root cause — don't just retry.
- **Subagent fails**: Check getTaskStatus. If the error is clear, fix it yourself. If not, spawn a new subagent with more specific context.
- **orchestrator fails**: Use getTaskStatus to find the failed node. Check its output. Fix the issue and re-run or handle manually.
- **Typecheck/lint errors after edit**: Use undo to revert, re-read the file, make a correct edit, then validateCode again.
- **Never**: retry the exact same failed action without understanding why it failed.

### Rules
${mode === 'PLAN' ? PLAN_RULES : BUILD_RULES}`);

    if (mode === 'BUILD' && !isSubagent) {
        parts.push(`## Task Lists
For complex multi-step requests (3+ distinct steps), use the **taskList** tool to create a visible checklist:

1. **Before starting work**: Call taskList with action="create" and your planned tasks.
2. **Auto-Progress**: The harness automatically advances and completes tasks based on the actions you take (e.g., successful editFile/writeFile, validateCode, or gitCommit matching task keywords or file names). You only need to create the list; the harness handles progress tracking silently!

This gives users visibility into your plan and progress. Always create a task list for:
- Bug fixes that involve investigation + fix + test
- Feature implementation with multiple files
- Refactoring across multiple modules
- Any request with 3+ explicit steps

Keep tasks concise (one line each). Group related work into single tasks.
Do NOT create task lists for simple single-step requests.`);

        parts.push(`## Specialized Subagents vs. Orchestrator Decision Tree
When deciding how to execute a request, follow this hierarchy:

| Task Type | Complexity & Scope | Action / Tool to Use |
| :--- | :--- | :--- |
| **Simple Changes** | Modifying 1-2 files, quick searches, simple bash commands. | **Direct tool calls** (e.g. \`editFile\`, \`readFile\`, \`bash\`) |
| **Focused Subtasks** | Code cleanup, writing tests for a file, debugging a localized error. | **Specialized Subagent Presets** (e.g. \`spawnTestWriter\`, \`spawnRefactor\`, \`spawnDebugger\`) |
| **Large-Scale Work** | 3+ files, multi-step features, research + implementation + testing. | **Orchestrated DAG Run** (\`orchestrator\` tool) |

### 1. Specialized Subagents Rules
- Specialized subagents have optimized system prompts for their roles (\`tester\`, \`refactorer\`, \`debugger\`).
- **Workspace Isolation & Auto-Handoff**: Subagents run in isolated environments without direct access to your active conversation history. However, the harness automatically injects a context block listing recently modified or git-dirty files from your active session into the subagent's task description so they know what you've worked on. You should still pass specific requirements and APIs inside the \`task\` parameter.
- **Batching**: Group related files into a single subagent execution block. Never launch separate subagents for individual files (e.g. do not call \`spawnTestWriter\` 10 times; instead, call it once passing an array of files). Max 5 concurrent subagent spawns per turn.

### 2. Orchestration (DAG) Rules
- The **orchestrator** splits complex tasks into a Directed Acyclic Graph (DAG) of subtasks, executing them in parallel based on dependencies.
- **Role Assignment**: Decomposed subtasks are assigned to specialized roles:
  - \`coder\`: Safe, precise implementation (mode: BUILD)
  - \`reviewer\`: AST/code analysis, code review comments (mode: PLAN)
  - \`tester\`: Comprehensive unit/integration tests (mode: BUILD)
  - \`researcher\`: Workspace audits, structure indexing (mode: PLAN)
  - \`debugger\`: Bug trace and root cause investigation (mode: BUILD)
- **Constraint**: Decomposition produces up to 8 nodes (typically 3-6). Group related files into single nodes.
- **State Passing**: Completed task outputs are automatically injected as prerequisites for downstream nodes.
- Use **getTaskStatus** to monitor runs, and **cancelTask** to abort.`);
    }

    if (mode === 'PLAN' && !isSubagent) {
        parts.push(`## Spawning Subagents
Use specialized presets for common tasks — they have optimized prompts:

- **spawnResearcher** — codebase analysis, architecture questions, tracing data flows. Best for "how does X work?" questions.
- **spawnCodeReviewer** — code review for bugs, security, performance. Provide file paths.
- **spawnAgent** — general-purpose for tasks that don't fit presets. Provide a fully self-contained prompt.

**Batching — Critical:**
Group related work into ONE subagent with a broader task, NOT one subagent per file. Max 5 spawn calls per response.
- GOOD: spawnResearcher({ question: "How does the auth and billing system work across src/auth.ts, src/billing.ts, and src/routes/" })
- BAD: spawnResearcher per file × 20 = wasteful, slow, and will be capped
When you need multiple subagents, emit ALL calls in a single response for concurrency.

You are in PLAN mode — subagent must also be PLAN.`);
    }

    const result = optimizePrompt(parts.join('\n'));

    promptCache.set(key, result);

    return result;
}

/**
 * Lean system prompt for subagent/worker requests.
 * Strips Memory, Env Management, Process Management, Spawning, Orchestrator sections.
 * Saves ~400 tokens per subagent call (~11K tokens for a 29-subagent orchestration).
 */
export function buildSubagentSystemPrompt({
    mode,
    projectContext,
    currentModel,
}: {
    mode: ModeType;
    projectContext?: string;
    currentModel?: string;
}): string {
    const key = `sub:${mode}:${currentModel ?? ''}:${projectContext ?? ''}`;
    const cached = subagentPromptCache.get(key);
    if (cached) return cached;

    const parts: string[] = [
        `You are a specialized worker agent. Complete the assigned task and return the result. Do NOT spawn further subagents.`,
        mode === 'BUILD'
            ? `## Mode: BUILD\nImplement changes directly. Read relevant code before modifying. Verify changes when possible.`
            : `## Mode: PLAN\nAnalyze, research, and propose — do NOT make changes.`,
    ];

    if (projectContext) {
        parts.push(`## Project Context\n${projectContext}`);
    }

    parts.push(`## Rules\n${buildSubagentRules(mode)}`);

    const result = optimizePrompt(parts.join('\n'));

    subagentPromptCache.set(key, result);

    return result;
}
