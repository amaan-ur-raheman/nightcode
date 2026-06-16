import { lstat, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { IGNORE, MAX_TREE_LINES, resolveInsideCwd } from './utils';

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

    const infos: { name: string; isDir: boolean }[] = [];
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

    // Collect subdirectory tree promises (parallel sibling traversal)
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

export async function treeTool(input: unknown) {
    const { path, depth } = toolInputSchemas.tree.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const root = relative(cwd, resolved) || '.';
    const lines = [root + '/', ...(await buildTree(resolved, '', 0, depth))];
    const truncated = lines.length > MAX_TREE_LINES;
    return {
        tree: (truncated ? lines.slice(0, MAX_TREE_LINES) : lines).join('\n'),
        ...(truncated ? { truncated: true, totalLines: lines.length } : {}),
    };
}
