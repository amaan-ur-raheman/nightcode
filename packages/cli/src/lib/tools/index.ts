export { readFileTool } from './read-file';
export { listDirectoryTool } from './list-directory';
export { globTool } from './glob';
export { grepTool } from './grep';
export { treeTool } from './tree';
export { fileInfoTool } from './file-info';
export { gitStatusTool, gitDiffTool } from './git';
export { gitCommitTool } from './git-commit';
export { gitBranchTool } from './git-branch';
export { gitLogTool } from './git-log';
export { gitBlameTool } from './git-blame';
export { gitStatusExtendedTool } from './git-status-extended';
export { webFetchTool } from './web-fetch';
export { codeSearchTool } from './code-search';
export { getOutlineTool } from './get-outline';
export { diffFilesTool } from './diff-files';
export { writeFileTool } from './write-file';
export { editFileTool } from './edit-file';
export { bashTool } from './bash';
export { patchTool } from './patch';
export { searchReplaceTool } from './search-replace';
export { deleteFileTool } from './delete-file';
export { moveFileTool } from './move-file';
export { createDirectoryTool } from './create-directory';
export { runTestsTool } from './run-tests';
export type { TestResult } from './run-tests';
export { httpRequestTool } from './http-request';
export { createFileTool } from './create-file';
export { renameSymbolTool } from './rename-symbol';
export { spawnAgentTool } from './spawn-agent';
export {
    spawnCodeReviewerTool,
    spawnTestWriterTool,
    spawnDebuggerTool,
    spawnRefactorTool,
    spawnResearcherTool,
} from './preset-agents';
export { tokenCountTool } from './token-count';
export { undoTool } from './undo';
export {
    memorySetTool,
    memoryGetTool,
    memoryDeleteTool,
    memoryListTool,
    memorySearchTool,
} from './memory';
export {
    keychainSetTool,
    keychainGetTool,
    keychainDeleteTool,
} from './keychain';
export { processManageTool } from './process-manage';
export { envManageTool } from './env-manage';
export { secretScanTool } from './secret-scan';
export { taskListTool } from './task-list';
export { askQuestionTool } from './ask-question';
export { useSkillTool, listSkillsTool } from './use-skill';

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
    readFile: () => import('./read-file').then((m) => m.readFileTool),
    listDirectory: () =>
        import('./list-directory').then((m) => m.listDirectoryTool),
    glob: () => import('./glob').then((m) => m.globTool),
    grep: () => import('./grep').then((m) => m.grepTool),
    tree: () => import('./tree').then((m) => m.treeTool),
    fileInfo: () => import('./file-info').then((m) => m.fileInfoTool),
    gitStatus: () => import('./git').then((m) => m.gitStatusTool),
    gitDiff: () => import('./git').then((m) => m.gitDiffTool),
    gitCommit: () => import('./git-commit').then((m) => m.gitCommitTool),
    gitBranch: () => import('./git-branch').then((m) => m.gitBranchTool),
    gitLog: () => import('./git-log').then((m) => m.gitLogTool),
    gitBlame: () => import('./git-blame').then((m) => m.gitBlameTool),
    gitStatusExtended: () =>
        import('./git-status-extended').then((m) => m.gitStatusExtendedTool),
    webFetch: () => import('./web-fetch').then((m) => m.webFetchTool),
    codeSearch: () => import('./code-search').then((m) => m.codeSearchTool),
    getOutline: () => import('./get-outline').then((m) => m.getOutlineTool),
    diffFiles: () => import('./diff-files').then((m) => m.diffFilesTool),
    writeFile: () => import('./write-file').then((m) => m.writeFileTool),
    editFile: () => import('./edit-file').then((m) => m.editFileTool),
    bash: () => import('./bash').then((m) => m.bashTool),
    patch: () => import('./patch').then((m) => m.patchTool),
    searchReplace: () =>
        import('./search-replace').then((m) => m.searchReplaceTool),
    deleteFile: () => import('./delete-file').then((m) => m.deleteFileTool),
    moveFile: () => import('./move-file').then((m) => m.moveFileTool),
    createDirectory: () =>
        import('./create-directory').then((m) => m.createDirectoryTool),
    runTests: () => import('./run-tests').then((m) => m.runTestsTool),
    httpRequest: () => import('./http-request').then((m) => m.httpRequestTool),
    createFile: () => import('./create-file').then((m) => m.createFileTool),
    renameSymbol: () =>
        import('./rename-symbol').then((m) => m.renameSymbolTool),
    spawnAgent: () => import('./spawn-agent').then((m) => m.spawnAgentTool),
    spawnCodeReviewer: () =>
        import('./preset-agents').then((m) => m.spawnCodeReviewerTool),
    spawnTestWriter: () =>
        import('./preset-agents').then((m) => m.spawnTestWriterTool),
    spawnDebugger: () =>
        import('./preset-agents').then((m) => m.spawnDebuggerTool),
    spawnRefactor: () =>
        import('./preset-agents').then((m) => m.spawnRefactorTool),
    spawnResearcher: () =>
        import('./preset-agents').then((m) => m.spawnResearcherTool),
    tokenCount: () => import('./token-count').then((m) => m.tokenCountTool),
    undo: () => import('./undo').then((m) => m.undoTool),
    memorySet: () => import('./memory').then((m) => m.memorySetTool),
    memoryGet: () => import('./memory').then((m) => m.memoryGetTool),
    memoryDelete: () => import('./memory').then((m) => m.memoryDeleteTool),
    memoryList: () => import('./memory').then((m) => m.memoryListTool),
    memorySearch: () => import('./memory').then((m) => m.memorySearchTool),
    keychainSet: () => import('./keychain').then((m) => m.keychainSetTool),
    keychainGet: () => import('./keychain').then((m) => m.keychainGetTool),
    keychainDelete: () =>
        import('./keychain').then((m) => m.keychainDeleteTool),
    processManage: () =>
        import('./process-manage').then((m) => m.processManageTool),
    envManage: () => import('./env-manage').then((m) => m.envManageTool),
    secretScan: () => import('./secret-scan').then((m) => m.secretScanTool),
    taskList: () => import('./task-list').then((m) => m.taskListTool),
    askQuestion: () => import('./ask-question').then((m) => m.askQuestionTool),
    useSkill: () => import('./use-skill').then((m) => m.useSkillTool),
    listSkills: () => import('./use-skill').then((m) => m.listSkillsTool),
    orchestrator: () =>
        import('./orchestrator').then((m) => m.orchestratorTool),
    getTaskStatus: () =>
        import('./orchestrator').then((m) => m.getTaskStatusTool),
    cancelTask: () => import('./orchestrator').then((m) => m.cancelTaskTool),
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

export { LAZY_TOOLS, loadTool };
