import { readdir, stat, realpath } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useKeyboard } from '@opentui/react';

import { useTheme } from '@/providers/theme';
import { useFileTree } from '@/providers/file-tree';
import { IGNORE, runGit } from '@/lib/tools/utils';
import type { ThemeColors } from '@/theme';
import { TextAttributes } from '@opentui/core';

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
}

interface FlatItem {
    node: FileNode;
    depth: number;
}

interface FileTreeProps {
    rootPath: string;
    selectedFile?: string;
    onSelectFile?: (path: string) => void;
}

let canonicalBase: string | null = null;

async function getCanonicalBase(): Promise<string> {
    if (canonicalBase) return canonicalBase;
    try {
        canonicalBase = await realpath(resolve(process.cwd()));
    } catch {
        canonicalBase = resolve(process.cwd());
    }
    return canonicalBase;
}

async function isSafePath(targetPath: string): Promise<boolean> {
    const base = await getCanonicalBase();
    try {
        const resolved = resolve(targetPath);
        let canonical: string;
        try {
            canonical = await realpath(resolved);
        } catch {
            canonical = resolved;
        }
        return canonical === base || canonical.startsWith(base + sep);
    } catch {
        return false;
    }
}

async function readDirNodes(dirPath: string): Promise<FileNode[]> {
    const nodes: FileNode[] = [];

    if (!(await isSafePath(dirPath))) {
        return nodes;
    }

    try {
        const entries = await readdir(dirPath);

        for (const entry of entries) {
            if (entry.startsWith('.') || IGNORE.has(entry)) continue;

            const fullPath = join(dirPath, entry);
            if (!(await isSafePath(fullPath))) continue;

            const stats = await stat(fullPath);

            nodes.push({
                name: entry,
                path: fullPath,
                isDirectory: stats.isDirectory(),
            });
        }

        nodes.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    } catch {
        // ignore read errors
    }

    return nodes;
}

type GitStatusCode = 'M' | 'A' | 'D' | 'R' | '?';

function getGitStatusColor(code: GitStatusCode, colors: ThemeColors): string {
    switch (code) {
        case 'M':
            return colors.info;
        case 'A':
            return colors.success;
        case 'D':
            return colors.error;
        case 'R':
            return colors.info;
        case '?':
            return colors.error;
        default:
            return colors.text;
    }
}

function getGitStatusIndicator(code: GitStatusCode): string {
    switch (code) {
        case 'M':
            return 'M ';
        case 'A':
            return 'A ';
        case 'D':
            return 'D ';
        case 'R':
            return 'R ';
        case '?':
            return '? ';
        default:
            return '  ';
    }
}

function parseGitStatus(
    output: string,
    cwd: string,
): Map<string, GitStatusCode> {
    const statusMap = new Map<string, GitStatusCode>();

    for (const line of output.split('\n')) {
        if (!line || line.length < 3) continue;
        const xy = line.slice(0, 2);
        const filePath = line.slice(3);

        let status: GitStatusCode;
        if (xy[0] === '?') {
            status = '?';
        } else if (xy[0] === 'A' || xy[1] === 'A') {
            status = 'A';
        } else if (xy[0] === 'D' || xy[1] === 'D') {
            status = 'D';
        } else if (xy[0] === 'R' || xy[1] === 'R') {
            status = 'R';
        } else if (xy.includes('M') || xy.includes('m')) {
            status = 'M';
        } else {
            continue;
        }

        const fullPath = join(cwd, filePath);
        statusMap.set(fullPath, status);
    }

    return statusMap;
}

export function FileTree({
    rootPath,
    selectedFile,
    onSelectFile,
}: FileTreeProps) {
    const { colors } = useTheme();
    const { fileTreeWidth, growTree, shrinkTree, closeFileTree, diffMode } =
        useFileTree();
    const [flatItems, setFlatItems] = useState<FlatItem[]>([]);
    const [isValid, setIsValid] = useState<boolean | null>(null);
    const [gitStatus, setGitStatus] = useState<Map<string, GitStatusCode>>(
        new Map(),
    );
    const [focusedIndex, setFocusedIndex] = useState(0);
    const expandedDirsRef = useRef<Set<string>>(new Set());
    const childrenCacheRef = useRef<Map<string, FileNode[]>>(new Map());

    // Load root nodes
    useEffect(() => {
        isSafePath(rootPath).then((safe) => {
            setIsValid(safe);
            if (safe) {
                readDirNodes(rootPath).then((nodes) => {
                    setFlatItems(nodes.map((node) => ({ node, depth: 0 })));
                });
            } else {
                setFlatItems([]);
            }
        });
    }, [rootPath]);

    // Fetch git status on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await runGit(rootPath, [
                    'status',
                    '--porcelain',
                ]);
                if (cancelled) return;
                if (result.exitCode === 0 && result.stdout) {
                    setGitStatus(parseGitStatus(result.stdout, rootPath));
                }
            } catch {
                // Not a git repo or git not available — ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [rootPath]);

    // Expand a directory: insert its children into flatItems after it
    const expandDir = useCallback(async (dirPath: string, depth: number) => {
        if (expandedDirsRef.current.has(dirPath)) return;
        expandedDirsRef.current.add(dirPath);

        let children = childrenCacheRef.current.get(dirPath);
        if (!children) {
            children = await readDirNodes(dirPath);
            childrenCacheRef.current.set(dirPath, children);
        }

        setFlatItems((prev) => {
            const idx = prev.findIndex((item) => item.node.path === dirPath);
            if (idx === -1) return prev;
            const newItems: FlatItem[] = children!.map((child) => ({
                node: child,
                depth: depth + 1,
            }));
            const next = [...prev];
            next.splice(idx + 1, 0, ...newItems);
            return next;
        });
    }, []);

    // Collapse a directory: remove its children from flatItems
    const collapseDir = useCallback((dirPath: string) => {
        if (!expandedDirsRef.current.has(dirPath)) return;
        expandedDirsRef.current.delete(dirPath);

        setFlatItems((prev) => {
            const idx = prev.findIndex((item) => item.node.path === dirPath);
            if (idx === -1) return prev;

            // Find all items after idx that have depth > this item's depth
            const dirDepth = prev[idx]!.depth;
            let removeCount = 0;
            for (let i = idx + 1; i < prev.length; i++) {
                if (prev[i]!.depth > dirDepth) {
                    removeCount++;
                } else {
                    break;
                }
            }

            // Also collapse any nested expanded dirs
            for (let i = idx + 1; i < idx + 1 + removeCount; i++) {
                const item = prev[i];
                if (item?.node.isDirectory) {
                    expandedDirsRef.current.delete(item.node.path);
                }
            }

            const next = [...prev];
            next.splice(idx + 1, removeCount);
            return next;
        });
    }, []);

    // Toggle directory expand/collapse
    const toggleDir = useCallback(
        (dirPath: string, depth: number) => {
            if (expandedDirsRef.current.has(dirPath)) {
                collapseDir(dirPath);
            } else {
                expandDir(dirPath, depth);
            }
        },
        [expandDir, collapseDir],
    );

    // In diff mode, only show files with git status
    const visibleItems = diffMode
        ? flatItems.filter(
              (item) => !item.node.isDirectory && gitStatus.has(item.node.path),
          )
        : flatItems;

    // Keyboard navigation
    useKeyboard((key) => {
        // [ / ] to resize tree
        if (key.name === '[') {
            key.preventDefault();
            shrinkTree();
            return;
        }
        if (key.name === ']') {
            key.preventDefault();
            growTree();
            return;
        }

        // ESC closes entire file tree
        if (key.name === 'escape') {
            key.preventDefault();
            closeFileTree();
            return;
        }

        if (visibleItems.length === 0) return;

        if (key.name === 'up' || key.name === 'k') {
            key.preventDefault();
            setFocusedIndex((prev) => Math.max(0, prev - 1));
        } else if (key.name === 'down' || key.name === 'j') {
            key.preventDefault();
            setFocusedIndex((prev) =>
                Math.min(visibleItems.length - 1, prev + 1),
            );
        } else if (key.name === 'right' || key.name === 'l') {
            key.preventDefault();
            const item = visibleItems[focusedIndex];
            if (item?.node.isDirectory) {
                if (!expandedDirsRef.current.has(item.node.path)) {
                    expandDir(item.node.path, item.depth);
                }
            } else if (item) {
                onSelectFile?.(item.node.path);
            }
        } else if (key.name === 'left' || key.name === 'h') {
            key.preventDefault();
            const item = visibleItems[focusedIndex];
            if (
                item?.node.isDirectory &&
                expandedDirsRef.current.has(item.node.path)
            ) {
                collapseDir(item.node.path);
            } else if (item && item.depth > 0) {
                // Move focus to parent directory
                const dirDepth = item.depth - 1;
                for (let i = focusedIndex - 1; i >= 0; i--) {
                    if (visibleItems[i]!.depth === dirDepth) {
                        setFocusedIndex(i);
                        break;
                    }
                }
            }
        } else if (key.name === 'return') {
            key.preventDefault();
            const item = visibleItems[focusedIndex];
            if (item?.node.isDirectory) {
                toggleDir(item.node.path, item.depth);
            } else if (item) {
                onSelectFile?.(item.node.path);
            }
        }
    });

    if (isValid === false) {
        return null;
    }

    // Truncate a filename to fit available width
    const truncateName = (
        name: string,
        depth: number,
        isDir: boolean,
    ): string => {
        // Available = total width - paddingLeft(1) - focusMarker(2) - indent(depth*2) - icon(2) - status(2)
        const overhead = 1 + 2 + depth * 2 + 2 + 2;
        const maxNameLen = fileTreeWidth - overhead - (isDir ? 1 : 0);
        if (maxNameLen < 3)
            return name.slice(0, Math.max(1, fileTreeWidth - overhead)) + '…';
        if (name.length > maxNameLen)
            return name.slice(0, maxNameLen - 1) + '…';
        return name;
    };

    return (
        <box
            flexDirection="column"
            width={fileTreeWidth}
            height="100%"
            border={['right']}
            borderColor={colors.dimSeparator}
            paddingLeft={1}
            paddingTop={1}
            overflow="hidden"
        >
            <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                {diffMode ? 'Changed Files' : 'Files'}
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                {diffMode
                    ? 'j/k nav • Enter diff • ESC close'
                    : 'j/k nav • Enter open • [/] resize'}
            </text>
            <box flexDirection="column" paddingTop={1}>
                {visibleItems.map((item, i) => {
                    const isFocused = i === focusedIndex;
                    const isSelected = selectedFile === item.node.path;
                    const indent = '  '.repeat(item.depth);
                    const icon = item.node.isDirectory
                        ? expandedDirsRef.current.has(item.node.path)
                            ? '▼ '
                            : '▶ '
                        : '  ';
                    const status = gitStatus?.get(item.node.path);
                    const statusIndicator = status
                        ? getGitStatusIndicator(status)
                        : '  ';
                    const statusColor = status
                        ? getGitStatusColor(status, colors)
                        : undefined;
                    const displayName = truncateName(
                        item.node.name,
                        item.depth,
                        item.node.isDirectory,
                    );

                    let fg = colors.text;
                    if (isFocused) fg = colors.selection;
                    else if (isSelected) fg = colors.primary;

                    return (
                        <text
                            key={item.node.path}
                            fg={fg}
                            wrapMode="none"
                            onMouseDown={() => {
                                setFocusedIndex(i);
                                if (item.node.isDirectory) {
                                    toggleDir(item.node.path, item.depth);
                                } else {
                                    onSelectFile?.(item.node.path);
                                }
                            }}
                        >
                            {isFocused ? '▸ ' : '  '}
                            {indent}
                            {icon}
                            <em fg={statusColor}>{statusIndicator}</em>
                            {displayName}
                            {item.node.isDirectory ? '/' : ''}
                        </text>
                    );
                })}
            </box>
        </box>
    );
}
