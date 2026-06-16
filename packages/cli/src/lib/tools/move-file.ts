import { mkdir, rename } from 'fs/promises';
import { dirname, relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { resolveInsideCwd } from './utils';
import { globCache } from '../glob-cache';
import { undoManager } from '../undo-manager';

export async function moveFileTool(input: unknown) {
    const { from, to } = toolInputSchemas.moveFile.parse(input);
    const { cwd, resolved: src } = resolveInsideCwd(from);
    const { resolved: dest } = resolveInsideCwd(to);

    // Backup source file before moving so the operation can be undone
    await undoManager.backup(src, 'moveFile', `Move ${from} → ${to}`);

    await mkdir(dirname(dest), { recursive: true });
    await rename(src, dest);
    globCache.invalidate();
    return {
        success: true as const,
        from: relative(cwd, src),
        to: relative(cwd, dest),
    };
}
