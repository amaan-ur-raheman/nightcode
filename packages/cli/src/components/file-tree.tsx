import { readdir, stat, realpath } from "fs/promises";
import { join, resolve, sep } from "path";
import { useState, useEffect } from "react";

import { useTheme } from "@/providers/theme";
import { IGNORE } from "@/lib/tools/utils";
import { TextAttributes } from "@opentui/core";

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
}

interface FileTreeProps {
    rootPath: string;
    selectedFile?: string;
    onSelectFile?: (path: string) => void;
    width?: number;
    maxDepth?: number;
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
            if (entry.startsWith(".") || IGNORE.has(entry)) continue;

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

function FileTreeNode({
    node,
    depth,
    selectedFile,
    onSelectFile,
    maxDepth,
}: {
    node: FileNode;
    depth: number;
    selectedFile?: string;
    onSelectFile?: (path: string) => void;
    maxDepth: number;
}) {
    const { colors } = useTheme();
    const [expanded, setExpanded] = useState(false);
    const [children, setChildren] = useState<FileNode[]>([]);

    const isSelected = selectedFile === node.path;
    const indent = "  ".repeat(depth);
    const icon = node.isDirectory ? (expanded ? "▼ " : "▶ ") : "  ";

    const handleClick = () => {
        if (node.isDirectory) {
            const nextExpanded = !expanded;
            setExpanded(nextExpanded);
            if (nextExpanded && children.length === 0) {
                readDirNodes(node.path).then(setChildren);
            }
        } else {
            onSelectFile?.(node.path);
        }
    };

    return (
        <box flexDirection="column">
            <text
                fg={isSelected ? colors.primary : colors.text}
                onMouseDown={handleClick}
            >
                {indent}
                {icon}
                {node.name}
                {node.isDirectory ? "/" : ""}
            </text>
            {node.isDirectory && expanded && depth < maxDepth && (
                <FileTreeChildren
                    dirPath={node.path}
                    depth={depth + 1}
                    selectedFile={selectedFile}
                    onSelectFile={onSelectFile}
                    maxDepth={maxDepth}
                />
            )}
        </box>
    );
}

function FileTreeChildren({
    dirPath,
    depth,
    selectedFile,
    onSelectFile,
    maxDepth,
}: {
    dirPath: string;
    depth: number;
    selectedFile?: string;
    onSelectFile?: (path: string) => void;
    maxDepth: number;
}) {
    const [nodes, setNodes] = useState<FileNode[]>([]);

    useEffect(() => {
        readDirNodes(dirPath).then(setNodes);
    }, [dirPath]);

    return (
        <box flexDirection="column">
            {nodes.map((node) => (
                <FileTreeNode
                    key={node.path}
                    node={node}
                    depth={depth}
                    selectedFile={selectedFile}
                    onSelectFile={onSelectFile}
                    maxDepth={maxDepth}
                />
            ))}
        </box>
    );
}

export function FileTree({
    rootPath,
    selectedFile,
    onSelectFile,
    width = 30,
    maxDepth = 3,
}: FileTreeProps) {
    const { colors } = useTheme();
    const [nodes, setNodes] = useState<FileNode[]>([]);
    const [isValid, setIsValid] = useState<boolean | null>(null);

    useEffect(() => {
        isSafePath(rootPath).then((safe) => {
            setIsValid(safe);
            if (safe) {
                readDirNodes(rootPath).then(setNodes);
            } else {
                setNodes([]);
            }
        });
    }, [rootPath]);

    if (isValid === false) {
        return null;
    }

    return (
        <box
            flexDirection="column"
            width={width}
            height="100%"
            border={["right"]}
            borderColor={colors.dimSeparator}
            paddingLeft={1}
            paddingTop={1}
            overflow="hidden"
        >
            <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                Files
            </text>
            <box flexDirection="column" paddingTop={1}>
                {nodes.map((node) => (
                    <FileTreeNode
                        key={node.path}
                        node={node}
                        depth={0}
                        selectedFile={selectedFile}
                        onSelectFile={onSelectFile}
                        maxDepth={maxDepth}
                    />
                ))}
            </box>
        </box>
    );
}
