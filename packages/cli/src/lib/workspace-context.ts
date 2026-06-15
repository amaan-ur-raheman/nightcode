import { AsyncLocalStorage } from 'async_hooks';

export interface WorkspaceStore {
    cwd: string;
    agentId: string;
}

export const workspaceLocalStorage = new AsyncLocalStorage<WorkspaceStore>();

/**
 * Gets the active project CWD (falls back to process.cwd() if outside an isolated agent context)
 */
export function getProjectCwd(): string {
    return workspaceLocalStorage.getStore()?.cwd ?? process.cwd();
}
