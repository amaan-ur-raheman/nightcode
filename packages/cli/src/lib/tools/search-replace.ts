import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { globCache } from '../glob-cache';
import { generateDiff, formatDiff } from '../diff-utils';

export async function searchReplaceTool(input: unknown) {
    const {
        pattern,
        replacement,
        glob: globPattern,
        flags,
    } = toolInputSchemas.searchReplace.parse(input);
    const normalizedFlags = [
        ...new Set(flags.includes('g') ? flags : flags + 'g'),
    ].join('');
    const regex = new RegExp(pattern, normalizedFlags);
    const cwd = process.cwd();

    const allMatches = await globCache.getCachedGlob(globPattern, cwd);
    const diffs: {
        path: string;
        diff: string;
        replacements: number;
        updated: string;
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
            updated,
        });
    }

    if (diffs.length === 0) {
        return { filesChanged: 0, changes: [] };
    }

    // Apply changes using cached content from the diff generation phase
    const { writeFile } = await import('fs/promises');
    const changes: { path: string; replacements: number }[] = [];

    for (const d of diffs) {
        const resolved = resolve(cwd, d.path);
        await writeFile(resolved, d.updated, 'utf-8');
        changes.push({ path: d.path, replacements: d.replacements });
    }
    globCache.invalidate();

    const diffSummary = diffs
        .map((d) => `--- ${d.path} (${d.replacements} replacements)\n${d.diff}`)
        .join('\n\n');

    return { filesChanged: changes.length, changes, diff: diffSummary };
}
