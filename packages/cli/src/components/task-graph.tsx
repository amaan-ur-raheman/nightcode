import React from 'react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import type { TaskGraph, TaskNode } from '@nightcode/shared';

type TaskGraphViewProps = {
    graph: TaskGraph;
    compact?: boolean;
};

const STATUS_SYMBOLS: Record<string, string> = {
    pending: '○',
    ready: '◎',
    running: '◉',
    completed: '●',
    failed: '✗',
    cancelled: '⊘',
};

const STATUS_COLORS: Record<
    string,
    keyof ReturnType<typeof useTheme>['colors']
> = {
    pending: 'dimSeparator',
    ready: 'info',
    running: 'info',
    completed: 'success',
    failed: 'error',
    cancelled: 'dimSeparator',
};

const ROLE_LABELS: Record<string, string> = {
    coder: '[CODER]',
    reviewer: '[REVIEW]',
    tester: '[TEST]',
    researcher: '[RESEARCH]',
    debugger: '[DEBUG]',
};

function formatToolName(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase());
}

function TaskNodeRow({ node, compact }: { node: TaskNode; compact?: boolean }) {
    const { colors } = useTheme();
    const symbol = STATUS_SYMBOLS[node.status] ?? '?';
    const colorKey = STATUS_COLORS[node.status] ?? 'dimSeparator';
    const roleLabel = ROLE_LABELS[node.type] ?? node.type;

    // Top 3 tools by count
    const topTools = node.toolsUsed
        ? Object.entries(node.toolsUsed)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 3)
        : [];
    const totalTools = node.toolsUsed ? Object.keys(node.toolsUsed).length : 0;

    return (
        <box flexDirection="column" gap={0} width="100%">
            <box flexDirection="row" gap={1} width="100%">
                <text fg={colors[colorKey]}>{symbol}</text>
                <text>{roleLabel}</text>
                {compact ? (
                    <text attributes={TextAttributes.DIM}>{node.id}</text>
                ) : (
                    <text>{node.description}</text>
                )}
                {node.dependencies.length > 0 && (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={colors.dimSeparator}
                    >
                        ← {node.dependencies.join(', ')}
                    </text>
                )}
            </box>
            {/* Real-time tool usage — only when running */}
            {node.status === 'running' && node.currentTool && (
                <box flexDirection="row" gap={1} paddingLeft={2} width="100%">
                    <text attributes={TextAttributes.DIM} fg={colors.info}>
                        → {formatToolName(node.currentTool)}
                        {node.currentToolInput
                            ? ` ${node.currentToolInput}`
                            : ''}
                    </text>
                </box>
            )}
            {/* Top tools used — show for running or completed */}
            {topTools.length > 0 && node.status !== 'pending' && (
                <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={2}
                    width="100%"
                    flexWrap="wrap"
                >
                    {topTools.map(([tool, count]) => (
                        <text
                            key={tool}
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            {tool}×{count}
                        </text>
                    ))}
                    {totalTools > 3 && (
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            +{totalTools - 3} more
                        </text>
                    )}
                </box>
            )}
        </box>
    );
}

export const TaskGraphView = React.memo(
    function TaskGraphView({ graph, compact = false }: TaskGraphViewProps) {
        const { colors } = useTheme();
        const nodes = Object.values(graph.nodes);

        // Topological sort for display order
        const sorted = (() => {
            const nodeMap = new Map(nodes.map((n) => [n.id, n]));
            const visited = new Set<string>();
            const order: TaskNode[] = [];

            function visit(id: string) {
                if (visited.has(id)) return;
                visited.add(id);
                const node = nodeMap.get(id);
                if (!node) return;
                for (const depId of node.dependencies) {
                    visit(depId);
                }
                order.push(node);
            }

            for (const n of nodes) visit(n.id);
            return order;
        })();

        return (
            <box flexDirection="column" gap={0} width="100%">
                <box flexDirection="row" gap={1} alignItems="center">
                    <text attributes={TextAttributes.BOLD}>Orchestration:</text>
                    <text
                        attributes={TextAttributes.DIM}
                        fg={colors.dimSeparator}
                    >
                        {graph.name.slice(0, 40)}
                    </text>
                </box>
                <box flexDirection="column" gap={0}>
                    {sorted.map((node) => (
                        <TaskNodeRow
                            key={node.id}
                            node={node}
                            compact={compact}
                        />
                    ))}
                </box>
                {graph.completedAt && (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={colors.dimSeparator}
                    >
                        Completed in{' '}
                        {((graph.completedAt - graph.createdAt) / 1000).toFixed(
                            1,
                        )}
                        s
                    </text>
                )}
            </box>
        );
    },
    (prev, next) =>
        prev.graph.version === next.graph.version &&
        prev.compact === next.compact,
);
