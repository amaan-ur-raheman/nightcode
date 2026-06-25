import { mkdir, readFile, writeFile, rm, rename } from 'fs/promises';
import { relative, dirname, resolve } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { resolveInsideCwd, MAX_PATCH_SIZE } from './utils';
import { generateDiff, formatDiff } from '../diff-utils';
import { undoManager } from '../undo-manager';
import { globCache } from '../glob-cache';
import { correctionTracker } from '../correction-tracker';

export async function editFileTool(input: unknown): Promise<any> {
    const parsed = toolInputSchemas.edit_file.parse(input);
    const { action } = parsed;

    if (action === 'edit') {
        const { path, oldString, newString } = parsed;
        if (!path || oldString === undefined || newString === undefined) {
            throw new Error(
                'path, oldString, and newString are required for edit action',
            );
        }
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
            } catch {
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

        await undoManager.backup(resolved, 'edit_file', `Edit ${path}`);
        await writeFile(resolved, newContent, 'utf-8');
        globCache.invalidate();
        return {
            success: true as const,
            path: relative(cwd, resolved),
            diff: diffOutput,
        };
    }

    if (action === 'patch') {
        const { patch } = parsed;
        if (!patch) {
            throw new Error('patch content is required for patch action');
        }
        const cwd = process.cwd();

        if (patch.length > MAX_PATCH_SIZE)
            return {
                error: `Patch exceeds maximum size of ${MAX_PATCH_SIZE} characters`,
            };

        const files = new Set<string>();
        for (const match of patch.matchAll(/^\+\+\+\s+b\/([^\t\r\n]+)/gm)) {
            const targetPath = match[1]!.trim();
            if (targetPath.includes('..'))
                return {
                    error: `Patch escapes project directory: ${targetPath}`,
                };
            const resolved = resolve(cwd, targetPath);
            if (!resolved.startsWith(cwd.endsWith('/') ? cwd : cwd + '/')) {
                return {
                    error: `Patch escapes project directory: ${targetPath}`,
                };
            }
            files.add(resolved);
        }

        for (const filePath of files) {
            await undoManager.backup(
                filePath,
                'edit_file',
                `Patch ${filePath}`,
            );
        }

        const proc = Bun.spawn(
            ['git', 'apply', '--reject', '--whitespace=fix'],
            {
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
                cwd,
            },
        );
        proc.stdin.write(patch);
        await proc.stdin.end();
        const [, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        await proc.exited;

        const diffPreview = patch
            .split('\n')
            .filter(
                (l) =>
                    l.startsWith('+') || l.startsWith('-') || l.startsWith('@'),
            )
            .slice(0, 20)
            .join('\n');

        if (proc.exitCode === 0)
            return {
                success: true as const,
                message: 'Patch applied cleanly',
                diff: diffPreview || patch.slice(0, 2000),
            };
        if (proc.exitCode === 1) {
            return {
                success: false,
                message: stderr.includes('.rej')
                    ? 'Patch partially applied; some hunks were rejected (.rej files created)'
                    : 'Patch failed to apply',
                stderr: stderr.slice(0, 5000),
            };
        }
        return { error: `git apply failed: ${stderr.trim()}` };
    }

    if (action === 'search_replace') {
        const { pattern, replacement, glob: globPattern, flags } = parsed;
        if (!pattern || replacement === undefined || !globPattern) {
            throw new Error(
                'pattern, replacement, and glob are required for search_replace action',
            );
        }
        const normalizedFlags = [
            ...new Set(
                (flags ?? 'g').includes('g')
                    ? (flags ?? 'g')
                    : (flags ?? 'g') + 'g',
            ),
        ].join('');
        const regex = new RegExp(pattern, normalizedFlags);
        const cwd = process.cwd();

        const allMatches = await globCache.getCachedGlob(globPattern, cwd);
        const diffs: {
            path: string;
            diff: string;
            replacements: number;
            content: string;
        }[] = [];

        for (const file of allMatches) {
            const resolved = resolve(cwd, file);
            const relPath = file;
            if (relPath.startsWith('..')) continue;

            const content = await readFile(resolved, 'utf-8');
            const count = (content.match(regex) || []).length;
            if (count === 0) continue;

            const updated = content.replace(regex, replacement);
            const diffLines = generateDiff(content, updated);
            const diffOutput = formatDiff(diffLines);
            diffs.push({
                path: relPath,
                diff: diffOutput,
                replacements: count,
                content: updated,
            });
        }

        if (diffs.length === 0) {
            return { filesChanged: 0, changes: [] };
        }

        // Apply changes with undo backup
        const changes: { path: string; replacements: number }[] = [];

        for (const d of diffs) {
            const resolved = resolve(cwd, d.path);
            await undoManager.backup(
                resolved,
                'edit_file',
                `Search-replace in ${d.path}`,
            );
            await writeFile(resolved, d.content, 'utf-8');
            changes.push({ path: d.path, replacements: d.replacements });
        }
        globCache.invalidate();

        const diffSummary = diffs
            .map(
                (d) =>
                    `--- ${d.path} (${d.replacements} replacements)\n${d.diff}`,
            )
            .join('\n\n');

        return { filesChanged: changes.length, changes, diff: diffSummary };
    }

    if (action === 'delete') {
        const { path, recursive } = parsed;
        if (!path) {
            throw new Error('path is required for delete action');
        }
        const { cwd, resolved } = resolveInsideCwd(path);

        if (resolved === cwd)
            return { error: 'Cannot delete the project root directory' };

        try {
            await undoManager.backup(resolved, 'edit_file', `Delete ${path}`);
            await rm(resolved, { recursive });
            globCache.invalidate();
            return { success: true as const, path: relative(cwd, resolved) };
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOTEMPTY')
                return {
                    error: 'Directory is not empty. Set recursive=true to force delete.',
                };
            if (code === 'ENOENT') return { error: 'Path not found.' };
            throw err;
        }
    }

    if (action === 'move') {
        const { path: from, to } = parsed;
        if (!from || !to) {
            throw new Error('path (from) and to are required for move action');
        }
        const { cwd, resolved: src } = resolveInsideCwd(from);
        const { resolved: dest } = resolveInsideCwd(to);

        await undoManager.backup(src, 'edit_file', `Move ${from} → ${to}`);
        await mkdir(dirname(dest), { recursive: true });
        await rename(src, dest);
        globCache.invalidate();
        return {
            success: true as const,
            from: relative(cwd, src),
            to: relative(cwd, dest),
        };
    }

    if (action === 'undo') {
        const correction = await correctionTracker.onUndo();
        const result = await undoManager.undoLast();
        if (!result) return { output: 'Nothing to undo' };

        const parts = [
            `Undid changes to ${result.filePath} (${result.restored ? 'success' : 'failed'})`,
        ];
        if (correction) {
            parts.push(`\nLearned correction: ${correction}`);
        }
        return { output: parts.join('') };
    }

    throw new Error(`Unknown action: ${action}`);
}
