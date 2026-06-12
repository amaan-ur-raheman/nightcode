import { readFile, writeFile } from 'fs/promises';
import { relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { resolveInsideCwd } from './utils';
import { generateDiff, formatDiff } from '../diff-utils';
import { undoManager } from '../undo-manager';
import { globCache } from '../glob-cache';

export async function editFileTool(input: unknown) {
    const { path, oldString, newString } =
        toolInputSchemas.editFile.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const content = await readFile(resolved, 'utf-8');
    let occurrences = 0;
    let idx = 0;
    while ((idx = content.indexOf(oldString, idx)) !== -1) {
        occurrences++;
        idx += oldString.length;
    }

    if (occurrences === 0) throw new Error('oldString not found in file');
    if (occurrences > 1)
        throw new Error(`oldString is ambiguous; found ${occurrences} matches`);

    const newContent = content.replace(oldString, () => newString);
    const diff = generateDiff(content, newContent);
    const diffOutput = formatDiff(diff);

    await undoManager.backup(resolved, 'editFile', `Edit ${path}`);
    await writeFile(resolved, newContent, 'utf-8');
    globCache.invalidate();
    return {
        success: true as const,
        path: relative(cwd, resolved),
        diff: diffOutput,
    };
}
