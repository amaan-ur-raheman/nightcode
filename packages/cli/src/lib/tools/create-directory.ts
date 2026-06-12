import { mkdir } from 'fs/promises';
import { relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { resolveInsideCwd } from './utils';

export async function createDirectoryTool(input: unknown) {
    const { path } = toolInputSchemas.createDirectory.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    await mkdir(resolved, { recursive: true });
    return { success: true as const, path: relative(cwd, resolved) };
}
