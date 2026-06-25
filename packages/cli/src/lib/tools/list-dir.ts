import { readdir, lstat } from 'fs/promises';
import { relative, resolve, join } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { IGNORE, MAX_TREE_LINES, MAX_RESULTS, resolveInsideCwd } from './utils';
import { globCache } from '../glob-cache';

async function buildTree(
    dir: string,
    prefix: string,
    depth: number,
    maxDepth: number,
): Promise<string[]> {
    if (depth > maxDepth) return [];
    const entries = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => !e.name.startsWith('.') && !IGNORE.has(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    const lines: string[] = [];

    const lstatPromises = entries.map(async (entry) => {
        try {
            const info = await lstat(join(dir, entry.name));
            return {
                name: entry.name,
                isDir: entry.isDirectory() && !info.isSymbolicLink(),
            };
        } catch {
            return null;
        }
    });
    const resolvedInfos = await Promise.all(lstatPromises);
    const lastNonNullIndex = resolvedInfos.findLastIndex(
        (info) => info !== null,
    );

    const childTreePromises: Promise<string[]>[] = [];
    for (let i = 0; i < resolvedInfos.length; i++) {
        const item = resolvedInfos[i];
        if (!item) {
            childTreePromises.push(Promise.resolve([]));
            continue;
        }
        const isLast = i === lastNonNullIndex;
        if (item.isDir) {
            childTreePromises.push(
                buildTree(
                    join(dir, item.name),
                    prefix + (isLast ? '    ' : '│   '),
                    depth + 1,
                    maxDepth,
                ),
            );
        } else {
            childTreePromises.push(Promise.resolve([]));
        }
    }

    const childResults = await Promise.all(childTreePromises);
    for (let i = 0; i < resolvedInfos.length; i++) {
        const item = resolvedInfos[i];
        if (!item) continue;
        const isLast = i === lastNonNullIndex;
        lines.push(
            prefix +
                (isLast ? '└── ' : '├── ') +
                item.name +
                (item.isDir ? '/' : ''),
        );
        const childLines = childResults[i];
        if (childLines && childLines.length > 0) {
            lines.push(...childLines);
        }
    }

    return lines;
}

export async function listDirTool(input: unknown) {
    const { path, recursive, depth, pattern } =
        toolInputSchemas.list_dir.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);

    if (pattern !== undefined) {
        // Glob pattern behavior
        const allMatches = await globCache.getCachedGlob(pattern, resolved);
        const files: string[] = [];
        let truncated = false;

        for (const match of allMatches) {
            if (match.split('/').some((seg) => IGNORE.has(seg))) continue;
            if (files.length >= MAX_RESULTS) {
                truncated = true;
                break;
            }
            files.push(relative(cwd, resolve(resolved, match)));
        }

        files.sort();
        return { files, ...(truncated ? { truncated: true } : {}) };
    }

    if (recursive) {
        // Tree behavior
        const root = relative(cwd, resolved) || '.';
        const lines = [
            root + '/',
            ...(await buildTree(resolved, '', 0, depth)),
        ];
        const truncated = lines.length > MAX_TREE_LINES;
        return {
            tree: (truncated ? lines.slice(0, MAX_TREE_LINES) : lines).join(
                '\n',
            ),
            ...(truncated ? { truncated: true, totalLines: lines.length } : {}),
        };
    }

    // Standard list directory behavior
    const entries = await readdir(resolved, { withFileTypes: true });

    const results = entries
        .filter(
            (entry) => !entry.name.startsWith('.') && !IGNORE.has(entry.name),
        )
        .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory()
                ? ('directory' as const)
                : ('file' as const),
        }));

    return {
        path: relative(cwd, resolved) || '.',
        entries: results.sort((a, b) =>
            a.type !== b.type
                ? a.type === 'directory'
                    ? -1
                    : 1
                : a.name.localeCompare(b.name),
        ),
    };
}
