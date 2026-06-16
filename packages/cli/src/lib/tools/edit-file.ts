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

    let isFuzzyMatch = false;
    let matchedString: string | null = null;

    if (occurrences === 0) {
        // Try fuzzy match by normalizing newlines and collapsing spaces/tabs
        const escapeRegExp = (str: string) =>
            str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lines = oldString.split(/\r?\n/);
        const linePatterns = lines.map((line) => {
            const trimmed = line.trim();
            if (trimmed === '') {
                return '[ \\t]*';
            }
            const escaped = escapeRegExp(trimmed);
            // Replace internal spaces/tabs with flexible horizontal spacing
            return '[ \\t]*' + escaped.replace(/[ \t]+/g, '[ \\t]+');
        });
        const patternStr = linePatterns.join(
            '[ \\t]*\\r?\\n(?:[ \\t]*\\r?\\n)*',
        );
        try {
            const regex = new RegExp(patternStr, 'g');
            const matches = content.match(regex);
            if (matches && matches.length === 1) {
                occurrences = 1;
                matchedString = matches[0];
                isFuzzyMatch = true;
            } else if (matches && matches.length > 1) {
                occurrences = matches.length;
            }
        } catch (e) {
            // Ignore regex construction errors and fall back to occurrences = 0
        }
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
        const matchLines: number[] = [];
        if (isFuzzyMatch) {
            const lines = oldString.split(/\r?\n/);
            const escapeRegExp = (str: string) =>
                str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const linePatterns = lines.map((line) => {
                const trimmed = line.trim();
                if (trimmed === '') return '[ \\t]*';
                return (
                    '[ \\t]*' +
                    escapeRegExp(trimmed).replace(/[ \t]+/g, '[ \\t]+')
                );
            });
            const patternStr = linePatterns.join(
                '[ \\t]*\\r?\\n(?:[ \\t]*\\r?\\n)*',
            );
            try {
                const regex = new RegExp(patternStr, 'g');
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const beforeMatch = content.slice(0, match.index);
                    const lineNum = beforeMatch.split('\n').length;
                    matchLines.push(lineNum);
                }
            } catch {}
        } else {
            let searchStart = 0;
            while (searchStart < content.length) {
                const idx = content.indexOf(oldString, searchStart);
                if (idx === -1) break;
                const lineNum = content.slice(0, idx).split('\n').length;
                matchLines.push(lineNum);
                searchStart = idx + oldString.length;
            }
        }

        return {
            error: `oldString is ambiguous; found ${occurrences} matches${matchLines.length > 0 ? ` on lines ${matchLines.join(', ')}` : ''}`,
            suggestion:
                'Include more surrounding context to make the match unique, or use line numbers to identify the correct location.',
            retryable: true,
        };
    }

    const newContent =
        isFuzzyMatch && matchedString
            ? content.replace(matchedString, () => newString)
            : content.replace(oldString, () => newString);
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
