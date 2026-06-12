import React, { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { useOrchestration } from '@/hooks/use-orchestration';
import { TaskGraphView } from '@/components/task-graph';
import type { TaskNode } from '@nightcode/shared';

export function OrchestrationDialogContent() {
    const { colors } = useTheme();
    const { activeOrchestrations, activeCount } = useOrchestration();
    const [selectedGraph, setSelectedGraph] = useState<string | null>(null);

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

    const currentGraph = activeOrchestrations.find(
        (s) => s.graph.id === selectedGraph,
    );

    return (
        <box flexDirection="column" gap={1} width="100%">
            {activeOrchestrations.map((state) => {
                const nodes = Object.values(state.graph.nodes);
                const completed = nodes.filter(
                    (n: TaskNode) => n.status === 'completed',
                ).length;
                const running = nodes.filter(
                    (n: TaskNode) => n.status === 'running',
                ).length;

                return (
                    <box
                        key={state.graph.id}
                        flexDirection="column"
                        gap={1}
                        paddingX={1}
                        paddingY={1}
                    >
                        <box flexDirection="row" gap={1} alignItems="center">
                            <box
                                onMouseDown={() =>
                                    setSelectedGraph(
                                        selectedGraph === state.graph.id
                                            ? null
                                            : state.graph.id,
                                    )
                                }
                            >
                                <text fg={colors.info}>◉</text>{' '}
                                {state.graph.name.slice(0, 30)}
                            </box>
                        </box>
                        <box flexDirection="row" gap={2} paddingLeft={2}>
                            <text attributes={TextAttributes.DIM}>
                                {completed}/{nodes.length} done
                            </text>
                            {running > 0 && (
                                <text
                                    fg={colors.info}
                                    attributes={TextAttributes.DIM}
                                >
                                    {running} running
                                </text>
                            )}
                            <text
                                attributes={TextAttributes.DIM}
                                fg={colors.dimSeparator}
                            >
                                {state.workerCount - state.completedWorkers}{' '}
                                active
                            </text>
                        </box>
                    </box>
                );
            })}

            {currentGraph && (
                <box paddingTop={1}>
                    <TaskGraphView graph={currentGraph.graph} compact />
                </box>
            )}
        </box>
    );
}
