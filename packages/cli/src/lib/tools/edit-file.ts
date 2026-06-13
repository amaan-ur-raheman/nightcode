import { readFile, writeFile } from 'fs/promises';
import { relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { resolveInsideCwd } from './utils';
import { generateDiff, formatDiff } from '../diff-utils';
import { undoManager } from '../undo-manager';
import { globCache } from '../glob-cache';

interface EditFileError {
    error: string;
    suggestion?: string;
    retryable?: boolean;
}

export async function editFileTool(
    input: unknown,
): Promise<{ success: true; path: string; diff: string } | EditFileError> {
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

    if (occurrences === 0) {
        return {
            error: 'oldString not found in file',
            suggestion:
                'Read the file first to verify the exact text, including whitespace and indentation.',
            retryable: true,
        };
    }

    if (occurrences > 1) {
        // Find line numbers for each occurrence
        const lines = content.split('\n');
        const matchLines: number[] = [];
        for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
            const line = lines[lineNum - 1];
            if (line && line.includes(oldString)) {
                matchLines.push(lineNum);
            }
        }

        return {
            error: `oldString is ambiguous; found ${occurrences} matches${matchLines.length > 0 ? ` on lines ${matchLines.join(', ')}` : ''}`,
            suggestion:
                'Include more surrounding context to make the match unique, or use line numbers to identify the correct location.',
            retryable: true,
        };
    }

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
