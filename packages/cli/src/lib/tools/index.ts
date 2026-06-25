export { readFileTool } from './read-file';
export { writeFileTool } from './write-file';
export { editFileTool } from './edit-file';
export { listDirTool } from './list-dir';
export { runCommandTool } from './run-command';
export { codeSearchTool } from './code-search';
export { gitOperationTool } from './git-operation';
export { knowledgeGraphTool } from './knowledge-graph';
export { spawnAgentTool } from './spawn-agent';
export { orchestrateTaskTool } from './orchestrate-task';
export { workspaceMemoryTool } from './workspace-memory';
export { manageKeychainTool } from './manage-keychain';
export { askQuestionTool } from './ask-question';
export { useSkillTool } from './use-skill';

type ToolFn =
    | ((input: unknown) => Promise<unknown>)
    | ((
          input: unknown,
          parentMode?: ModeType,
          parentModel?: string,
          signal?: AbortSignal,
          execId?: string,
      ) => Promise<unknown>);

type ModeType = 'BUILD' | 'PLAN';

type LazyToolLoader = () => Promise<ToolFn>;

const LAZY_TOOLS: Record<string, LazyToolLoader> = {
    read_file: () => import('./read-file').then((m) => m.readFileTool),
    write_file: () => import('./write-file').then((m) => m.writeFileTool),
    edit_file: () => import('./edit-file').then((m) => m.editFileTool),
    list_dir: () => import('./list-dir').then((m) => m.listDirTool),
    run_command: () => import('./run-command').then((m) => m.runCommandTool),
    code_search: () => import('./code-search').then((m) => m.codeSearchTool),
    git_operation: () =>
        import('./git-operation').then((m) => m.gitOperationTool),
    knowledge_graph: () =>
        import('./knowledge-graph').then((m) => m.knowledgeGraphTool),
    spawn_agent: () => import('./spawn-agent').then((m) => m.spawnAgentTool),
    orchestrate_task: () =>
        import('./orchestrate-task').then((m) => m.orchestrateTaskTool),
    workspace_memory: () =>
        import('./workspace-memory').then((m) => m.workspaceMemoryTool),
    manage_keychain: () =>
        import('./manage-keychain').then((m) => m.manageKeychainTool),
    ask_question: () => import('./ask-question').then((m) => m.askQuestionTool),
    use_skill: () => import('./use-skill').then((m) => m.useSkillTool),
};

const toolCache = new Map<string, ToolFn>();

async function loadTool(name: string): Promise<ToolFn> {
    const cached = toolCache.get(name);
    if (cached) return cached;

    const loader = LAZY_TOOLS[name];
    if (!loader) throw new Error(`Unknown tool: ${name}`);

    const tool = await loader();
    toolCache.set(name, tool);
    return tool;
}

/**
 * Preload commonly used tools in the background to reduce first-use latency.
 */
export function preloadTools(): void {
    const commonTools = [
        'read_file',
        'edit_file',
        'write_file',
        'list_dir',
        'run_command',
        'code_search',
        'git_operation',
    ];
    for (const name of commonTools) {
        if (!toolCache.has(name)) {
            loadTool(name).catch(() => {});
        }
    }
}

export { LAZY_TOOLS, loadTool };
