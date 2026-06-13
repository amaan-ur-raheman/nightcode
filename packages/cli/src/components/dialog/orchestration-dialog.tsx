import React, { useState, useEffect, useRef } from 'react';
import { TextAttributes, InputRenderable, ScrollBoxRenderable } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { useOrchestration } from '@/hooks/use-orchestration';
import { TaskGraphView } from '@/components/task-graph';
import type { TaskNode, TaskGraph } from '@nightcode/shared';
import { getTopologicalOrder, checkGraphCompletion } from '@nightcode/shared';
import { useKeyboard } from '@opentui/react';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { orchestratorManager } from '@/lib/orchestrator-manager';
import { apiClient } from '@/lib/api-client';
import { lastSession } from '@/index';

interface OrchestrationDialogContentProps {
    sessionId?: string;
}

const STATUS_SYMBOLS: Record<string, string> = {
    pending: '○',
    ready: '◎',
    running: '◉',
    completed: '●',
    failed: '✗',
    cancelled: '⊘',
    paused: '⏸',
};

const STATUS_COLORS: Record<string, 'dimSeparator' | 'info' | 'success' | 'error' | 'primary'> = {
    pending: 'dimSeparator',
    ready: 'info',
    running: 'info',
    completed: 'success',
    failed: 'error',
    cancelled: 'dimSeparator',
    paused: 'primary',
};

const ROLE_EMOJIS: Record<string, string> = {
    coder: '💻',
    reviewer: '🔍',
    tester: '🧪',
    researcher: '📚',
    debugger: '🐛',
    orchestrator: '🎯',
};

export function OrchestrationDialogContent({ sessionId: propSessionId }: OrchestrationDialogContentProps = {}) {
    const sessionId = propSessionId || lastSession.id || '';
    const { colors } = useTheme();
    const { activeOrchestrations, activeCount } = useOrchestration();
    const { isTopLayer } = useKeyboardLayer();

    const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
    const [mode, setMode] = useState<'graphs' | 'nodes' | 'detail' | 'edit' | 'force_complete'>('graphs');

    // Selection indices
    const [graphIndex, setGraphIndex] = useState(0);
    const [nodeIndex, setNodeIndex] = useState(0);
    const [actionIndex, setActionIndex] = useState(0);
    const [focusedFieldIndex, setFocusedFieldIndex] = useState(0);

    // Uncontrolled input states and Scroll refs
    const descInputRef = useRef<InputRenderable>(null);
    const filesInputRef = useRef<InputRenderable>(null);
    const resultInputRef = useRef<InputRenderable>(null);
    const graphsScrollRef = useRef<ScrollBoxRenderable>(null);
    const nodesScrollRef = useRef<ScrollBoxRenderable>(null);

    const [editDesc, setEditDesc] = useState('');
    const [editFiles, setEditFiles] = useState('');
    const [resultInput, setResultInput] = useState('');

    const activeGraphs = activeOrchestrations;
    const currentGraphState = activeGraphs.find(
        (s) => s.graph.id === selectedGraphId,
    ) || activeGraphs[graphIndex] || null;

    const currentGraph = currentGraphState?.graph || null;
    const nodeOrder = currentGraph ? getTopologicalOrder(currentGraph) : [];
    const sortedNodes = currentGraph ? (nodeOrder.map(id => currentGraph.nodes[id]).filter(Boolean) as TaskNode[]) : [];
    const currentNode = sortedNodes[nodeIndex] || null;

    // Reset cursor indices/inputs when mode transitions
    useEffect(() => {
        if (mode === 'edit' && currentNode) {
            setEditDesc(currentNode.description);
            setEditFiles(currentNode.files.join(', '));
            setFocusedFieldIndex(0);
            setTimeout(() => {
                if (descInputRef.current) descInputRef.current.value = currentNode.description;
                if (filesInputRef.current) filesInputRef.current.value = currentNode.files.join(', ');
            }, 10);
        } else if (mode === 'force_complete') {
            setResultInput('');
            setTimeout(() => {
                if (resultInputRef.current) resultInputRef.current.value = '';
            }, 10);
        }
    }, [mode, currentNode]);

    const getAvailableActions = (node: TaskNode) => {
        const actions: { id: string; label: string }[] = [];
        if (node.status === 'running') {
            actions.push({ id: 'pause', label: '⏸ Pause Task' });
        } else if (node.status === 'paused') {
            actions.push({ id: 'resume', label: '▶ Resume Task' });
        }
        if (node.status === 'failed' || node.status === 'cancelled' || node.status === 'completed') {
            actions.push({ id: 'retry', label: '🔄 Retry Task' });
        }
        actions.push({ id: 'force_complete', label: '🏁 Force Complete' });
        actions.push({ id: 'edit', label: '✏ Edit Details' });
        actions.push({ id: 'back', label: '← Back to Tasks' });
        return actions;
    };

    const handleAction = async (actionId: string) => {
        if (!currentGraph || !currentNode) return;
        const targetNode = currentGraph.nodes[currentNode.id];
        if (!targetNode) return;

        if (actionId === 'pause') {
            targetNode.status = 'paused';
            orchestratorManager.abortTask(currentGraph.id, targetNode.id);
            orchestratorManager.updateGraph(currentGraph);
            try {
                await apiClient.orchestrator.sessions[':sessionId'].graphs[':graphId'].nodes[':nodeId'].$put({
                    param: { sessionId, graphId: currentGraph.id, nodeId: targetNode.id },
                    json: { status: 'paused' },
                });
            } catch (err) {
                console.error('Failed to update node in DB:', err);
            }
            setMode('detail');
        } else if (actionId === 'resume') {
            targetNode.status = 'pending';
            targetNode.error = undefined;
            orchestratorManager.updateGraph(currentGraph);
            try {
                await apiClient.orchestrator.sessions[':sessionId'].graphs[':graphId'].nodes[':nodeId'].$put({
                    param: { sessionId, graphId: currentGraph.id, nodeId: targetNode.id },
                    json: { status: 'pending', error: null },
                });
            } catch (err) {
                console.error('Failed to update node in DB:', err);
            }
            setMode('detail');
        } else if (actionId === 'retry') {
            targetNode.status = 'pending';
            targetNode.error = undefined;
            targetNode.result = undefined;
            orchestratorManager.updateGraph(currentGraph);
            try {
                await apiClient.orchestrator.sessions[':sessionId'].graphs[':graphId'].nodes[':nodeId'].$put({
                    param: { sessionId, graphId: currentGraph.id, nodeId: targetNode.id },
                    json: { status: 'pending', error: null, result: null },
                });
            } catch (err) {
                console.error('Failed to update node in DB:', err);
            }
            setMode('detail');
        } else if (actionId === 'force_complete') {
            setMode('force_complete');
        } else if (actionId === 'edit') {
            setMode('edit');
        } else if (actionId === 'back') {
            setMode('nodes');
        }
    };

    const handleSaveEdit = async () => {
        if (!currentGraph || !currentNode) return;
        const targetNode = currentGraph.nodes[currentNode.id];
        if (!targetNode) return;

        const filesArr = editFiles.split(',').map(f => f.trim()).filter(Boolean);
        targetNode.description = editDesc;
        targetNode.files = filesArr;

        orchestratorManager.updateGraph(currentGraph);

        try {
            await apiClient.orchestrator.sessions[':sessionId'].graphs[':graphId'].nodes[':nodeId'].$put({
                param: { sessionId, graphId: currentGraph.id, nodeId: targetNode.id },
                json: { description: editDesc, files: filesArr },
            });
        } catch (err) {
            console.error('Failed to update node in DB:', err);
        }

        setMode('detail');
    };

    const handleSaveForceComplete = async () => {
        if (!currentGraph || !currentNode) return;
        const targetNode = currentGraph.nodes[currentNode.id];
        if (!targetNode) return;

        if (targetNode.status === 'running') {
            orchestratorManager.abortTask(currentGraph.id, targetNode.id);
        }

        targetNode.status = 'completed';
        targetNode.result = resultInput;
        targetNode.error = undefined;

        checkGraphCompletion(currentGraph);
        orchestratorManager.updateGraph(currentGraph);

        try {
            await apiClient.orchestrator.sessions[':sessionId'].graphs[':graphId'].nodes[':nodeId'].$put({
                param: { sessionId, graphId: currentGraph.id, nodeId: targetNode.id },
                json: { status: 'completed', result: resultInput, error: null },
            });
        } catch (err) {
            console.error('Failed to update node in DB:', err);
        }

        setMode('detail');
    };

    const keyHandlerRef = useRef<((key: any) => void) | undefined>(undefined);
    keyHandlerRef.current = (key) => {
        if (!isTopLayer('dialog')) return;

        if (mode === 'graphs') {
            if (key.name === 'down') {
                key.preventDefault();
                setGraphIndex((i) => {
                    const newIndex = Math.min(i + 1, activeGraphs.length - 1);
                    const sb = graphsScrollRef.current;
                    if (sb) {
                        const viewportHeight = sb.viewport?.height || 8;
                        const visibleEnd = sb.scrollTop + viewportHeight - 1;
                        if (newIndex > visibleEnd) {
                            sb.scrollTo(newIndex - viewportHeight + 1);
                        }
                    }
                    return newIndex;
                });
            } else if (key.name === 'up') {
                key.preventDefault();
                setGraphIndex((i) => {
                    const newIndex = Math.max(0, i - 1);
                    graphsScrollRef.current?.scrollTo(newIndex);
                    return newIndex;
                });
            } else if (key.name === 'return' || key.name === 'enter' || key.name === 'right') {
                key.preventDefault();
                const g = activeGraphs[graphIndex];
                if (g) {
                    setSelectedGraphId(g.graph.id);
                    setMode('nodes');
                    setNodeIndex(0);
                    setTimeout(() => {
                        nodesScrollRef.current?.scrollTo(0);
                    }, 10);
                }
            }
        } else if (mode === 'nodes') {
            if (key.name === 'down') {
                key.preventDefault();
                setNodeIndex((i) => {
                    const newIndex = Math.min(i + 1, sortedNodes.length - 1);
                    const sb = nodesScrollRef.current;
                    if (sb) {
                        const viewportHeight = sb.viewport?.height || 9;
                        const visibleEnd = sb.scrollTop + viewportHeight - 1;
                        if (newIndex > visibleEnd) {
                            sb.scrollTo(newIndex - viewportHeight + 1);
                        }
                    }
                    return newIndex;
                });
            } else if (key.name === 'up') {
                key.preventDefault();
                setNodeIndex((i) => {
                    const newIndex = Math.max(0, i - 1);
                    nodesScrollRef.current?.scrollTo(newIndex);
                    return newIndex;
                });
            } else if (key.name === 'return' || key.name === 'enter' || key.name === 'right') {
                key.preventDefault();
                const n = sortedNodes[nodeIndex];
                if (n) {
                    setMode('detail');
                    setActionIndex(0);
                }
            } else if (key.name === 'escape' || key.name === 'left') {
                key.preventDefault();
                setMode('graphs');
                setTimeout(() => {
                    graphsScrollRef.current?.scrollTo(graphIndex);
                }, 10);
            }
        } else if (mode === 'detail') {
            const actions = currentNode ? getAvailableActions(currentNode) : [];
            if (key.name === 'down') {
                key.preventDefault();
                setActionIndex((i) => Math.min(i + 1, actions.length - 1));
            } else if (key.name === 'up') {
                key.preventDefault();
                setActionIndex((i) => Math.max(0, i - 1));
            } else if (key.name === 'return' || key.name === 'enter' || key.name === 'right') {
                key.preventDefault();
                const act = actions[actionIndex];
                if (act) {
                    handleAction(act.id);
                }
            } else if (key.name === 'escape' || key.name === 'left') {
                key.preventDefault();
                setMode('nodes');
                setTimeout(() => {
                    nodesScrollRef.current?.scrollTo(nodeIndex);
                }, 10);
            }
        } else if (mode === 'edit') {
            if (key.name === 'tab' || key.name === 'down') {
                key.preventDefault();
                setFocusedFieldIndex((i) => (i + 1) % 2);
            } else if (key.name === 'up') {
                key.preventDefault();
                setFocusedFieldIndex((i) => (i - 1 + 2) % 2);
            } else if (key.name === 'escape') {
                key.preventDefault();
                setMode('detail');
            } else if (key.name === 'return' && key.ctrl) {
                key.preventDefault();
                void handleSaveEdit();
            }
        } else if (mode === 'force_complete') {
            if (key.name === 'escape') {
                key.preventDefault();
                setMode('detail');
            } else if (key.name === 'return' && key.ctrl) {
                key.preventDefault();
                void handleSaveForceComplete();
            }
        }
    };

    useKeyboard((key) => {
        keyHandlerRef.current?.(key);
    });

    if (activeCount === 0) {
        return (
            <box flexDirection="column" gap={1} paddingY={1}>
                <text attributes={TextAttributes.DIM}>
                    No active orchestrations
                </text>
                <text attributes={TextAttributes.DIM}>
                    Use the orchestrator tool to decompose complex tasks into
                    parallelizable subtasks.
                </text>
            </box>
        );
    }

    if (mode === 'graphs') {
        return (
            <box flexDirection="column" gap={1} width="100%">
                <text attributes={TextAttributes.BOLD} fg={colors.primary} marginBottom={1}>
                    🎯 Active Orchestrations:
                </text>
                <scrollbox ref={graphsScrollRef} height={8}>
                    {activeGraphs.map((state, i) => {
                        const isSelected = i === graphIndex;
                        const nodes = Object.values(state.graph.nodes);
                        const completed = nodes.filter((n: TaskNode) => n.status === 'completed').length;
                        const running = nodes.filter((n: TaskNode) => n.status === 'running').length;

                        return (
                            <box
                                key={state.graph.id}
                                flexDirection="column"
                                gap={0}
                                paddingX={2}
                                paddingY={1}
                                border={['bottom', 'left', 'right', 'top']}
                                borderColor={isSelected ? colors.primary : colors.dimSeparator}
                                backgroundColor={isSelected ? colors.selection : undefined}
                                onMouseMove={() => setGraphIndex(i)}
                                onMouseDown={() => {
                                    setSelectedGraphId(state.graph.id);
                                    setMode('nodes');
                                    setNodeIndex(0);
                                    setTimeout(() => {
                                        nodesScrollRef.current?.scrollTo(0);
                                    }, 10);
                                }}
                                marginBottom={1}
                                width="100%"
                            >
                                <box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between" width="100%">
                                    <box flexDirection="row" gap={1}>
                                        <text fg={isSelected ? 'black' : colors.primary} attributes={TextAttributes.BOLD}>
                                            {isSelected ? '▶ ' : '  '}
                                            {state.graph.name.slice(0, 35)}
                                        </text>
                                    </box>
                                    <text fg={isSelected ? 'black' : colors.text} attributes={TextAttributes.BOLD}>
                                        {completed}/{nodes.length} Done
                                    </text>
                                </box>
                                <box flexDirection="row" gap={3} paddingLeft={2} marginTop={1}>
                                    {running > 0 && (
                                        <text fg={isSelected ? 'black' : colors.info} attributes={TextAttributes.BOLD}>
                                            ◉ {running} Running
                                        </text>
                                    )}
                                    <text fg={isSelected ? 'black' : colors.dimSeparator} attributes={TextAttributes.DIM}>
                                        ⚡ {state.workerCount - state.completedWorkers} Active Workers
                                    </text>
                                </box>
                            </box>
                        );
                    })}
                </scrollbox>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator} marginTop={1}>
                    Press Left/Right/Up/Down to navigate, Enter to inspect
                </text>
            </box>
        );
    }

    if (mode === 'nodes' && currentGraph) {
        return (
            <box flexDirection="column" gap={1} width="100%">
                <box flexDirection="column" gap={0} marginBottom={1} width="100%">
                    <box flexDirection="row" gap={1} alignItems="center">
                        <text fg={colors.primary} onMouseDown={() => setMode('graphs')} attributes={TextAttributes.BOLD}>
                            📂 Active Orchestrations
                        </text>
                        <text fg={colors.dimSeparator}>›</text>
                        <text fg={colors.text} attributes={TextAttributes.BOLD}>
                            {currentGraph.name.slice(0, 32)}
                        </text>
                    </box>
                    <box border={['bottom']} borderColor={colors.dimSeparator} marginTop={1} width="100%" />
                </box>

                <text attributes={TextAttributes.DIM} marginBottom={1}>
                    Select a task node to inspect details or run controls:
                </text>

                <scrollbox ref={nodesScrollRef} height={9} border={['bottom', 'left', 'right', 'top']} borderColor={colors.dimSeparator} paddingX={1} paddingY={1}>
                    {sortedNodes.map((node, i) => {
                        const isSelected = i === nodeIndex;
                        const symbol = STATUS_SYMBOLS[node.status] || '○';
                        const colorKey = STATUS_COLORS[node.status] || 'dimSeparator';
                        const emoji = ROLE_EMOJIS[node.type] || '🤖';
                        return (
                            <box
                                key={node.id}
                                flexDirection="row"
                                gap={1}
                                backgroundColor={isSelected ? colors.selection : undefined}
                                onMouseMove={() => setNodeIndex(i)}
                                onMouseDown={() => {
                                    setMode('detail');
                                    setActionIndex(0);
                                }}
                                width="100%"
                                paddingX={1}
                                marginBottom={0}
                            >
                                <text fg={isSelected ? 'black' : colors[colorKey]} attributes={TextAttributes.BOLD}>
                                    {isSelected ? '▶' : symbol}
                                </text>
                                <text fg={isSelected ? 'black' : colors.text} attributes={TextAttributes.BOLD}>
                                    {emoji} {node.id}
                                </text>
                                <text fg={isSelected ? 'black' : colors.text} flexGrow={1} overflow="hidden">
                                    {` - ${node.description.slice(0, 32)}`}
                                </text>
                            </box>
                        );
                    })}
                </scrollbox>

                <box border={['bottom', 'left', 'right', 'top']} borderColor={colors.dimSeparator} paddingTop={1} paddingX={2} paddingY={1} marginTop={1} width="100%">
                    <text attributes={TextAttributes.BOLD} fg={colors.primary} marginBottom={1}>
                        📊 Topology Dependency Map
                    </text>
                    <TaskGraphView graph={currentGraph} compact />
                </box>
                
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator} marginTop={1}>
                    Press Left/Right/Up/Down to navigate, Esc to go back
                </text>
            </box>
        );
    }

    if (mode === 'detail' && currentNode && currentGraph) {
        const actions = getAvailableActions(currentNode);
        const symbol = STATUS_SYMBOLS[currentNode.status] || '○';
        const colorKey = STATUS_COLORS[currentNode.status] || 'dimSeparator';
        const emoji = ROLE_EMOJIS[currentNode.type] || '🤖';

        return (
            <box flexDirection="column" gap={1} width="100%">
                <box flexDirection="column" gap={0} marginBottom={1} width="100%">
                    <box flexDirection="row" gap={1} alignItems="center">
                        <text fg={colors.primary} onMouseDown={() => setMode('nodes')} attributes={TextAttributes.BOLD}>
                            {currentGraph.name.slice(0, 20)}
                        </text>
                        <text fg={colors.dimSeparator}>›</text>
                        <text fg={colors.text} attributes={TextAttributes.BOLD}>
                            {currentNode.id}
                        </text>
                    </box>
                    <box border={['bottom']} borderColor={colors.dimSeparator} marginTop={1} width="100%" />
                </box>

                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.primary}
                    paddingX={2}
                    paddingY={1}
                    flexDirection="column"
                    gap={1}
                    width="100%"
                >
                    <box flexDirection="row" justifyContent="space-between" width="100%">
                        <text fg={colors.primary} attributes={TextAttributes.BOLD}>🆔 {currentNode.id}</text>
                        <text fg={colors.primary}>{emoji} {currentNode.type.toUpperCase()}</text>
                    </box>
                    <box border={['bottom']} borderColor={colors.dimSeparator} width="100%" />
                    <box flexDirection="row" gap={2} alignItems="center">
                        <text attributes={TextAttributes.DIM}>Status:</text>
                        <box backgroundColor={colors[colorKey]} paddingX={1}>
                            <text fg="black" attributes={TextAttributes.BOLD}>
                                {symbol} {currentNode.status.toUpperCase()}
                            </text>
                        </box>
                    </box>
                    <box flexDirection="column" gap={0} marginTop={1}>
                        <text attributes={TextAttributes.DIM}>Description:</text>
                        <text fg={colors.text} attributes={TextAttributes.BOLD}>{currentNode.description}</text>
                    </box>
                    <box flexDirection="column" gap={0} marginTop={1}>
                        <text attributes={TextAttributes.DIM}>Associated Files:</text>
                        <text fg={colors.text}>{currentNode.files.join(', ') || '(none)'}</text>
                    </box>
                </box>

                {currentNode.result && (
                    <box flexDirection="column" gap={0} width="100%" marginTop={1}>
                        <text attributes={TextAttributes.DIM} marginBottom={1}>📂 Result output:</text>
                        <scrollbox height={4} border={['bottom', 'left', 'right', 'top']} borderColor={colors.dimSeparator} paddingX={1}>
                            <text fg={colors.text}>{currentNode.result}</text>
                        </scrollbox>
                    </box>
                )}

                {currentNode.error && (
                    <box flexDirection="column" gap={0} width="100%" marginTop={1}>
                        <text fg={colors.error} attributes={TextAttributes.DIM} marginBottom={1}>❌ Error logs:</text>
                        <scrollbox height={3} border={['bottom', 'left', 'right', 'top']} borderColor={colors.error} paddingX={1}>
                            <text fg={colors.error}>{currentNode.error}</text>
                        </scrollbox>
                    </box>
                )}

                <box flexDirection="column" gap={1} marginTop={1} width="100%">
                    <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                        ⚙️ Controls & Overrides:
                    </text>
                    <box flexDirection="column" gap={0}>
                        {actions.map((act, i) => {
                            const isSelected = i === actionIndex;
                            return (
                                <box
                                    key={act.id}
                                    paddingX={2}
                                    paddingY={0}
                                    backgroundColor={isSelected ? colors.selection : undefined}
                                    onMouseMove={() => setActionIndex(i)}
                                    onMouseDown={() => handleAction(act.id)}
                                >
                                    <text fg={isSelected ? 'black' : colors.text} attributes={TextAttributes.BOLD}>
                                        {isSelected ? '▶ ' : '  '}
                                        {act.label}
                                    </text>
                                </box>
                            );
                        })}
                    </box>
                </box>
                
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator} marginTop={1}>
                    Press Left/Right/Up/Down to navigate, Esc to go back
                </text>
            </box>
        );
    }

    if (mode === 'edit' && currentNode) {
        return (
            <box flexDirection="column" gap={1} width="100%">
                <text attributes={TextAttributes.BOLD} fg={colors.primary} marginBottom={1}>
                    ✏️ Edit Task Specifications: {currentNode.id}
                </text>

                <box flexDirection="column" gap={0} width="100%">
                    <text attributes={TextAttributes.BOLD} fg={colors.primary} marginBottom={1}>
                        Description:
                    </text>
                    <box
                        border={['bottom', 'left', 'right', 'top']}
                        borderColor={focusedFieldIndex === 0 ? colors.primary : colors.dimSeparator}
                        paddingX={1}
                    >
                        <input
                            ref={descInputRef}
                            focused={focusedFieldIndex === 0}
                            onContentChange={() => setEditDesc(descInputRef.current?.value ?? '')}
                        />
                    </box>
                </box>

                <box flexDirection="column" gap={0} width="100%" marginTop={1}>
                    <text attributes={TextAttributes.BOLD} fg={colors.primary} marginBottom={1}>
                        Files (comma-separated):
                    </text>
                    <box
                        border={['bottom', 'left', 'right', 'top']}
                        borderColor={focusedFieldIndex === 1 ? colors.primary : colors.dimSeparator}
                        paddingX={1}
                    >
                        <input
                            ref={filesInputRef}
                            focused={focusedFieldIndex === 1}
                            onContentChange={() => setEditFiles(filesInputRef.current?.value ?? '')}
                        />
                    </box>
                </box>

                <box flexDirection="row" gap={2} marginTop={2}>
                    <box
                        paddingX={2}
                        backgroundColor={colors.primary}
                        onMouseDown={handleSaveEdit}
                    >
                        <text fg="black" attributes={TextAttributes.BOLD}>
                            [Save Changes]
                        </text>
                    </box>
                    <box
                        paddingX={2}
                        backgroundColor={colors.error}
                        onMouseDown={() => setMode('detail')}
                    >
                        <text fg="black" attributes={TextAttributes.BOLD}>
                            [Cancel]
                        </text>
                    </box>
                </box>
                <text fg={colors.dimSeparator} attributes={TextAttributes.DIM} marginTop={1}>
                    Press Tab to switch fields, Ctrl+Enter to save, Esc to cancel
                </text>
            </box>
        );
    }

    if (mode === 'force_complete' && currentNode) {
        return (
            <box flexDirection="column" gap={1} width="100%">
                <text attributes={TextAttributes.BOLD} fg={colors.primary} marginBottom={1}>
                    🏁 Force Task Completion: {currentNode.id}
                </text>

                <box flexDirection="column" gap={0} width="100%">
                    <text attributes={TextAttributes.BOLD} fg={colors.primary} marginBottom={1}>
                        Custom Mock Result Output:
                    </text>
                    <box
                        border={['bottom', 'left', 'right', 'top']}
                        borderColor={colors.success}
                        paddingX={1}
                    >
                        <input
                            ref={resultInputRef}
                            focused={true}
                            onContentChange={() => setResultInput(resultInputRef.current?.value ?? '')}
                        />
                    </box>
                </box>

                <box flexDirection="row" gap={2} marginTop={2}>
                    <box
                        paddingX={2}
                        backgroundColor={colors.success}
                        onMouseDown={handleSaveForceComplete}
                    >
                        <text fg="black" attributes={TextAttributes.BOLD}>
                            [Complete Task]
                        </text>
                    </box>
                    <box
                        paddingX={2}
                        backgroundColor={colors.error}
                        onMouseDown={() => setMode('detail')}
                    >
                        <text fg="black" attributes={TextAttributes.BOLD}>
                            [Cancel]
                        </text>
                    </box>
                </box>
                <text fg={colors.dimSeparator} attributes={TextAttributes.DIM} marginTop={1}>
                    Press Ctrl+Enter to apply, Esc to cancel
                </text>
            </box>
        );
    }

    return null;
}
