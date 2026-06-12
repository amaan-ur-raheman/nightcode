import { mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { debug } from './debug';

const WORKSPACE_ROOT = join(homedir(), '.nightcode', 'workspace');

export interface WorkspaceContext {
    projectInfo?: string;
    sharedData: Record<string, unknown>;
}

export async function createWorkspace(graphId: string): Promise<string> {
    const dir = join(WORKSPACE_ROOT, graphId);
    await mkdir(join(dir, 'context'), { recursive: true });
    await mkdir(join(dir, 'results'), { recursive: true });
    await mkdir(join(dir, 'messages'), { recursive: true });
    await mkdir(join(dir, 'files'), { recursive: true });
    debug.log('workspace', `Created workspace: ${dir}`);
    return dir;
}

export async function writeResult(
    graphId: string,
    taskId: string,
    result: string,
): Promise<void> {
    const filePath = join(WORKSPACE_ROOT, graphId, 'results', `${taskId}.json`);
    await writeFile(
        filePath,
        JSON.stringify({ taskId, result, timestamp: Date.now() }),
        'utf-8',
    );
}

export async function readResult(
    graphId: string,
    taskId: string,
): Promise<string | null> {
    try {
        const filePath = join(
            WORKSPACE_ROOT,
            graphId,
            'results',
            `${taskId}.json`,
        );
        const content = await readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        return data.result;
    } catch {
        return null;
    }
}

export async function readAllResults(
    graphId: string,
): Promise<Record<string, string>> {
    const resultsDir = join(WORKSPACE_ROOT, graphId, 'results');
    const results: Record<string, string> = {};

    try {
        const files = await readdir(resultsDir);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const content = await readFile(join(resultsDir, file), 'utf-8');
            const data = JSON.parse(content);
            results[data.taskId] = data.result;
        }
    } catch {}

    return results;
}

export async function shareContext(
    graphId: string,
    key: string,
    value: unknown,
): Promise<void> {
    const filePath = join(WORKSPACE_ROOT, graphId, 'context', `${key}.json`);
    await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

export async function readContext(
    graphId: string,
    key: string,
): Promise<unknown> {
    try {
        const filePath = join(
            WORKSPACE_ROOT,
            graphId,
            'context',
            `${key}.json`,
        );
        const content = await readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

export async function setProjectInfo(
    graphId: string,
    info: string,
): Promise<void> {
    const filePath = join(
        WORKSPACE_ROOT,
        graphId,
        'context',
        'project-info.md',
    );
    await writeFile(filePath, info, 'utf-8');
}

export async function getProjectInfo(graphId: string): Promise<string | null> {
    try {
        const filePath = join(
            WORKSPACE_ROOT,
            graphId,
            'context',
            'project-info.md',
        );
        return await readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

export async function cleanupWorkspace(graphId: string): Promise<void> {
    const dir = join(WORKSPACE_ROOT, graphId);
    try {
        await rm(dir, { recursive: true, force: true });
        debug.log('workspace', `Cleaned up workspace: ${dir}`);
    } catch {}
}

export function getWorkspaceDir(graphId: string): string {
    return join(WORKSPACE_ROOT, graphId);
}
