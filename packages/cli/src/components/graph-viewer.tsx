import React, { useState, useEffect, useRef } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { knowledgeGraphManager } from '@/lib/knowledge-graph';
import type { KnowledgeNode, KnowledgeNeighbor } from '@nightcode/shared';
import { Spinner } from '@/components/spinner';

type GraphViewerProps = {
    onClose: () => void;
    onSelectFile: (filePath: string, line?: number) => void;
};

type ColumnFocus = 'incoming' | 'center' | 'outgoing';

export function GraphViewer({ onClose, onSelectFile }: GraphViewerProps) {
    const { colors } = useTheme();
    const dimensions = useTerminalDimensions();
    const { isTopLayer, push, pop } = useKeyboardLayer();

    const [loading, setLoading] = useState(false);
    const [graph, setGraph] = useState<any>(null);
    const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
    const [neighbors, setNeighbors] = useState<KnowledgeNeighbor[]>([]);
    const [columnFocus, setColumnFocus] = useState<ColumnFocus>('center');
    const [incomingIndex, setIncomingIndex] = useState(0);
    const [outgoingIndex, setOutgoingIndex] = useState(0);

    // Load graph on mount
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const loaded = await knowledgeGraphManager.load();
                setGraph(loaded);
                // Select first node (preferably a file or class)
                const allNodes = Array.from(
                    loaded.nodes.values(),
                ) as KnowledgeNode[];
                const defaultNode =
                    allNodes.find((n) => n.type === 'file') ??
                    allNodes.find((n) => n.type === 'class') ??
                    allNodes[0];
                if (defaultNode) {
                    setCurrentNodeId(defaultNode.id);
                }
            } catch {
                // ignore
            } finally {
                setLoading(false);
            }
        };
        init();
    }, []);

    // Load neighbors when center node changes
    useEffect(() => {
        if (!currentNodeId) {
            setNeighbors([]);
            return;
        }
        const loadNeighbors = async () => {
            try {
                const list =
                    await knowledgeGraphManager.getNeighbors(currentNodeId);
                setNeighbors(list);
                setIncomingIndex(0);
                setOutgoingIndex(0);
            } catch (err) {
                console.error('Failed to load graph neighbors:', err);
                setNeighbors([]);
                setIncomingIndex(0);
                setOutgoingIndex(0);
            }
        };
        loadNeighbors();
    }, [currentNodeId]);

    // Push keyboard layer
    useEffect(() => {
        push('graph', () => true);
        return () => {
            pop('graph');
        };
    }, [push, pop]);

    // Filter neighbors
    const incomingNeighbors = neighbors.filter(
        (n) => n.direction === 'incoming',
    );
    const outgoingNeighbors = neighbors.filter(
        (n) => n.direction === 'outgoing',
    );

    const currentNode =
        currentNodeId && graph
            ? (graph.nodes.get(currentNodeId) as KnowledgeNode)
            : null;

    const handleRebuild = async () => {
        setLoading(true);
        try {
            await knowledgeGraphManager.buildFromProject(process.cwd());
            const loaded = await knowledgeGraphManager.load();
            setGraph(loaded);
            const allNodes = Array.from(
                loaded.nodes.values(),
            ) as KnowledgeNode[];
            const defaultNode =
                allNodes.find((n) => n.type === 'file') ??
                allNodes.find((n) => n.type === 'class') ??
                allNodes[0];
            if (defaultNode) {
                setCurrentNodeId(defaultNode.id);
            }
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    };

    const handleCenterChange = (nodeId: string) => {
        setCurrentNodeId(nodeId);
        setColumnFocus('center');
    };

    const handleOpenFile = (node: KnowledgeNode | null) => {
        if (node && node.filePath) {
            onSelectFile(node.filePath, node.startLine);
        }
    };

    const keyHandlerRef = useRef<((key: any) => void) | undefined>(undefined);
    keyHandlerRef.current = (key) => {
        if (!isTopLayer('graph') || loading) return;

        if (key.name === 'escape') {
            key.preventDefault();
            onClose();
            return;
        }

        if (key.name === 'b' || key.name === 'r') {
            key.preventDefault();
            handleRebuild();
            return;
        }

        // Arrow Key Navigation
        if (key.name === 'left') {
            key.preventDefault();
            if (columnFocus === 'outgoing') {
                setColumnFocus('center');
            } else if (
                columnFocus === 'center' &&
                incomingNeighbors.length > 0
            ) {
                setColumnFocus('incoming');
            }
        } else if (key.name === 'right') {
            key.preventDefault();
            if (columnFocus === 'incoming') {
                setColumnFocus('center');
            } else if (
                columnFocus === 'center' &&
                outgoingNeighbors.length > 0
            ) {
                setColumnFocus('outgoing');
            }
        } else if (key.name === 'up') {
            key.preventDefault();
            if (columnFocus === 'incoming' && incomingNeighbors.length > 0) {
                setIncomingIndex((prev) =>
                    prev > 0 ? prev - 1 : incomingNeighbors.length - 1,
                );
            } else if (
                columnFocus === 'outgoing' &&
                outgoingNeighbors.length > 0
            ) {
                setOutgoingIndex((prev) =>
                    prev > 0 ? prev - 1 : outgoingNeighbors.length - 1,
                );
            }
        } else if (key.name === 'down') {
            key.preventDefault();
            if (columnFocus === 'incoming' && incomingNeighbors.length > 0) {
                setIncomingIndex((prev) =>
                    prev < incomingNeighbors.length - 1 ? prev + 1 : 0,
                );
            } else if (
                columnFocus === 'outgoing' &&
                outgoingNeighbors.length > 0
            ) {
                setOutgoingIndex((prev) =>
                    prev < outgoingNeighbors.length - 1 ? prev + 1 : 0,
                );
            }
        }

        // Action Keys
        if (key.name === 'return' || key.name === 'enter') {
            key.preventDefault();
            if (
                columnFocus === 'incoming' &&
                incomingNeighbors[incomingIndex]
            ) {
                handleCenterChange(incomingNeighbors[incomingIndex].node.id);
            } else if (
                columnFocus === 'outgoing' &&
                outgoingNeighbors[outgoingIndex]
            ) {
                handleCenterChange(outgoingNeighbors[outgoingIndex].node.id);
            } else if (columnFocus === 'center') {
                handleOpenFile(currentNode);
            }
        }

        // File jump shortcuts: 'o' or 'f'
        if (key.name === 'o' || key.name === 'f') {
            key.preventDefault();
            if (
                columnFocus === 'incoming' &&
                incomingNeighbors[incomingIndex]
            ) {
                handleOpenFile(incomingNeighbors[incomingIndex].node);
            } else if (
                columnFocus === 'outgoing' &&
                outgoingNeighbors[outgoingIndex]
            ) {
                handleOpenFile(outgoingNeighbors[outgoingIndex].node);
            } else if (columnFocus === 'center') {
                handleOpenFile(currentNode);
            }
        }
    };

    useKeyboard((key) => {
        keyHandlerRef.current?.(key);
    });

    if (loading) {
        return (
            <box
                flexDirection="column"
                gap={1}
                padding={2}
                alignItems="center"
                justifyContent="center"
                height={15}
            >
                <Spinner mode="BUILD" />
                <text fg={colors.text}>
                    Processing Workspace Knowledge Graph...
                </text>
            </box>
        );
    }

    const hasNodes = graph && graph.nodes.size > 0;

    if (!hasNodes) {
        return (
            <box
                flexDirection="column"
                gap={1}
                paddingX={4}
                paddingY={2}
                alignItems="center"
                justifyContent="center"
                height={15}
                width={Math.min(86, dimensions.width - 12)}
            >
                <text fg={colors.error} attributes={TextAttributes.BOLD}>
                    Workspace Knowledge Graph Empty
                </text>
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    Scan your project files to index symbols and dependencies.
                </text>
                <box
                    marginTop={1}
                    paddingX={2}
                    paddingY={1}
                    border={['top', 'bottom', 'left', 'right']}
                    borderColor={colors.primary}
                    flexDirection="column"
                    alignItems="center"
                    gap={1}
                >
                    <box flexDirection="row" gap={1}>
                        <text
                            fg={colors.success}
                            attributes={TextAttributes.BOLD}
                        >
                            Press 'b'
                        </text>
                        <text fg={colors.text}>
                            to build/index workspace knowledge
                        </text>
                    </box>
                    <text fg={colors.text} attributes={TextAttributes.DIM}>
                        (This scans files & extracts code symbols/dependencies)
                    </text>
                </box>
            </box>
        );
    }

    const width = Math.min(86, dimensions.width - 12);
    const sideColWidth = Math.floor(width * 0.28);
    const centerColWidth = width - sideColWidth * 2 - 4;

    return (
        <box flexDirection="column" width={width} height={18} gap={1}>
            {/* Header info */}
            <box
                flexDirection="row"
                justifyContent="space-between"
                paddingBottom={1}
                border={['bottom']}
                borderColor={colors.dimSeparator}
            >
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    Total Nodes: {graph.nodes.size} | Edges: {graph.edges.size}
                </text>
                <text fg={colors.primary}>
                    Left/Right: switch column | Up/Down: select neighbor |
                    Enter: re-center / open code
                </text>
            </box>

            {/* Columns */}
            <box flexDirection="row" flexGrow={1} gap={1} width="100%">
                {/* Incoming Column */}
                <box flexDirection="column" width={sideColWidth} height="100%">
                    <text
                        fg={
                            columnFocus === 'incoming'
                                ? colors.primary
                                : colors.text
                        }
                        attributes={TextAttributes.BOLD}
                    >
                        Incoming Connections ({incomingNeighbors.length})
                    </text>
                    <box
                        border={['top', 'bottom', 'left', 'right']}
                        borderColor={
                            columnFocus === 'incoming'
                                ? colors.primary
                                : colors.dimSeparator
                        }
                        flexGrow={1}
                        padding={1}
                        flexDirection="column"
                    >
                        <scrollbox flexGrow={1}>
                            {incomingNeighbors.length === 0 ? (
                                <text
                                    fg={colors.text}
                                    attributes={TextAttributes.DIM}
                                >
                                    No incoming imports/calls
                                </text>
                            ) : (
                                incomingNeighbors.map((n, idx) => {
                                    const isSelected =
                                        columnFocus === 'incoming' &&
                                        idx === incomingIndex;
                                    return (
                                        <box
                                            key={n.node.id}
                                            flexDirection="row"
                                            gap={1}
                                        >
                                            <text
                                                fg={
                                                    isSelected
                                                        ? colors.success
                                                        : colors.text
                                                }
                                            >
                                                {isSelected ? '▶' : ' '}
                                            </text>
                                            <text
                                                fg={
                                                    isSelected
                                                        ? colors.success
                                                        : colors.text
                                                }
                                                attributes={
                                                    isSelected
                                                        ? TextAttributes.BOLD
                                                        : undefined
                                                }
                                            >
                                                {n.node.name}
                                            </text>
                                            <text
                                                fg={colors.text}
                                                attributes={TextAttributes.DIM}
                                            >
                                                ({n.edge.type})
                                            </text>
                                        </box>
                                    );
                                })
                            )}
                        </scrollbox>
                    </box>
                </box>

                {/* Unicode connector arrow (Left to Center) */}
                <box
                    flexDirection="column"
                    justifyContent="center"
                    height="100%"
                    paddingX={1}
                >
                    <text fg={colors.dimSeparator}>───▶</text>
                </box>

                {/* Center Focused Node */}
                <box
                    flexDirection="column"
                    width={centerColWidth}
                    height="100%"
                >
                    <text
                        fg={
                            columnFocus === 'center'
                                ? colors.primary
                                : colors.text
                        }
                        attributes={TextAttributes.BOLD}
                    >
                        Focused Symbol
                    </text>
                    <box
                        border={['top', 'bottom', 'left', 'right']}
                        borderColor={
                            columnFocus === 'center'
                                ? colors.primary
                                : colors.dimSeparator
                        }
                        flexGrow={1}
                        padding={1}
                        flexDirection="column"
                        gap={1}
                    >
                        {currentNode ? (
                            <>
                                <box flexDirection="row" gap={1}>
                                    <text
                                        fg={colors.primary}
                                        attributes={TextAttributes.BOLD}
                                    >
                                        {currentNode.name}
                                    </text>
                                    <text
                                        fg={colors.text}
                                        attributes={TextAttributes.DIM}
                                    >
                                        [{currentNode.type}]
                                    </text>
                                </box>
                                {currentNode.filePath && (
                                    <box flexDirection="column">
                                        <text
                                            fg={colors.text}
                                            attributes={TextAttributes.DIM}
                                        >
                                            File:
                                        </text>
                                        <text fg={colors.text}>
                                            {currentNode.filePath}:
                                            {currentNode.startLine ?? 1}
                                        </text>
                                    </box>
                                )}
                                {currentNode.description && (
                                    <box flexDirection="column" marginTop={1}>
                                        <text
                                            fg={colors.text}
                                            attributes={TextAttributes.DIM}
                                        >
                                            Description:
                                        </text>
                                        <text fg={colors.text}>
                                            {currentNode.description}
                                        </text>
                                    </box>
                                )}
                                <box
                                    marginTop="auto"
                                    flexDirection="column"
                                    border={['top']}
                                    borderColor={colors.dimSeparator}
                                    paddingTop={1}
                                >
                                    <text
                                        fg={colors.success}
                                        attributes={TextAttributes.DIM}
                                    >
                                        Press 'o' or 'f' to open code file
                                    </text>
                                </box>
                            </>
                        ) : (
                            <text fg={colors.text}>No node selected</text>
                        )}
                    </box>
                </box>

                {/* Unicode connector arrow (Center to Right) */}
                <box
                    flexDirection="column"
                    justifyContent="center"
                    height="100%"
                    paddingX={1}
                >
                    <text fg={colors.dimSeparator}>───▶</text>
                </box>

                {/* Outgoing Column */}
                <box flexDirection="column" width={sideColWidth} height="100%">
                    <text
                        fg={
                            columnFocus === 'outgoing'
                                ? colors.primary
                                : colors.text
                        }
                        attributes={TextAttributes.BOLD}
                    >
                        Outgoing Connections ({outgoingNeighbors.length})
                    </text>
                    <box
                        border={['top', 'bottom', 'left', 'right']}
                        borderColor={
                            columnFocus === 'outgoing'
                                ? colors.primary
                                : colors.dimSeparator
                        }
                        flexGrow={1}
                        padding={1}
                        flexDirection="column"
                    >
                        <scrollbox flexGrow={1}>
                            {outgoingNeighbors.length === 0 ? (
                                <text
                                    fg={colors.text}
                                    attributes={TextAttributes.DIM}
                                >
                                    No outgoing dependencies
                                </text>
                            ) : (
                                outgoingNeighbors.map((n, idx) => {
                                    const isSelected =
                                        columnFocus === 'outgoing' &&
                                        idx === outgoingIndex;
                                    return (
                                        <box
                                            key={n.node.id}
                                            flexDirection="row"
                                            gap={1}
                                        >
                                            <text
                                                fg={
                                                    isSelected
                                                        ? colors.success
                                                        : colors.text
                                                }
                                            >
                                                {isSelected ? '▶' : ' '}
                                            </text>
                                            <text
                                                fg={
                                                    isSelected
                                                        ? colors.success
                                                        : colors.text
                                                }
                                                attributes={
                                                    isSelected
                                                        ? TextAttributes.BOLD
                                                        : undefined
                                                }
                                            >
                                                {n.node.name}
                                            </text>
                                            <text
                                                fg={colors.text}
                                                attributes={TextAttributes.DIM}
                                            >
                                                ({n.edge.type})
                                            </text>
                                        </box>
                                    );
                                })
                            )}
                        </scrollbox>
                    </box>
                </box>
            </box>

            {/* Footer tips */}
            <box
                flexDirection="row"
                justifyContent="space-between"
                paddingTop={1}
                border={['top']}
                borderColor={colors.dimSeparator}
            >
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    b: build knowledge / rebuild | o/f: open file | esc: close
                </text>
            </box>
        </box>
    );
}
