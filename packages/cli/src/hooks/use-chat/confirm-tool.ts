import {
    ConfirmationManager,
    getConfirmationLevel,
    formatToolInput,
    getAccessPath,
    getPatterns,
} from '@/lib/tools/dangerous-ops';
import { isConfirmationEnabled } from '@/lib/settings';
import { toUnifiedDiff } from '@/lib/diff-utils';
import { readFile } from 'fs/promises';
import { resolveInsideCwd } from '@/lib/tools/utils';

/**
 * Unified confirmation gate for tool execution.
 * Returns { confirmed: true } if the tool should proceed,
 * or { confirmed: false, output: 'Action cancelled by user' } if cancelled.
 */
export async function confirmToolIfNeeded(
    toolName: string,
    input: unknown,
    isMcpTool: boolean,
    confirmationManager: ConfirmationManager,
): Promise<{ confirmed: true } | { confirmed: false; output: string }> {
    if (isMcpTool || !isConfirmationEnabled()) {
        return { confirmed: true };
    }
    const { level, reason } = getConfirmationLevel(toolName, input);
    if (level !== 'confirm') {
        return { confirmed: true };
    }
    const details = formatToolInput(toolName, input);

    // Compute preview diff if appropriate
    let diff: string | undefined;
    if (toolName === 'editFile') {
        try {
            const { path, oldString, newString } = input as {
                path: string;
                oldString: string;
                newString: string;
            };
            const { resolved } = resolveInsideCwd(path);
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
                const escapeRegExp = (str: string) =>
                    str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const lines = oldString.split(/\r?\n/);
                const linePatterns = lines.map((line) => {
                    const trimmed = line.trim();
                    if (trimmed === '') {
                        return '[ \\t]*';
                    }
                    const escaped = escapeRegExp(trimmed);
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
                    // ignore
                }
            }

            if (occurrences === 1) {
                const newContent =
                    isFuzzyMatch && matchedString
                        ? content.replace(matchedString, () => newString)
                        : content.replace(oldString, () => newString);
                diff = toUnifiedDiff(path, content, newContent);
            }
        } catch (e) {
            // ignore
        }
    } else if (toolName === 'writeFile') {
        try {
            const { path, content } = input as {
                path: string;
                content: string;
            };
            const { resolved } = resolveInsideCwd(path);
            let existingContent = '';
            try {
                existingContent = await readFile(resolved, 'utf-8');
            } catch {
                // New file
            }
            diff = toUnifiedDiff(path, existingContent, content);
        } catch (e) {
            // ignore
        }
    } else if (toolName === 'patch') {
        try {
            const { patch } = input as { patch: string };
            diff = patch;
        } catch (e) {
            // ignore
        }
    }

    const confirmed = await confirmationManager.request(
        toolName,
        reason,
        details,
        getAccessPath(toolName, input),
        getPatterns(toolName, input),
        diff,
    );
    if (!confirmed) {
        return { confirmed: false, output: 'Action cancelled by user' };
    }
    return { confirmed: true };
}
