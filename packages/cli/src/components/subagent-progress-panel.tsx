import React, { useState, useEffect } from 'react';
import prettyMs from 'pretty-ms';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

import {
    getActiveSubagents,
    getSubagentForToolCall,
    onSubagentChange,
    type SubagentInfo,
} from '@/lib/subagent-progress';

type SubagentProgressPanelProps = {
    /** When true, show the full panel. When false, show a compact indicator. */
    expanded?: boolean;
    /** Filter to only the subagent spawned by this tool call. */
    toolCallId?: string;
};

function formatToolName(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase());
}

function StepProgress({
    step,
    maxSteps,
    colors,
}: {
    step: number;
    maxSteps: number;
    colors: any;
}) {
    const width = 12;
    const progress = maxSteps > 0 ? step / maxSteps : 0;
    const filled = Math.round(progress * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);

    return (
        <box>
            <text fg={colors.info}>{bar.slice(0, filled)}</text>
            <text fg={colors.dimSeparator}>{bar.slice(filled)}</text>
            <text fg={colors.dimSeparator}>
                {' '}
                {step}/{maxSteps}
            </text>
        </box>
    );
}

function SubagentRow({ info, index }: { info: SubagentInfo; index: number }) {
    const { colors } = useTheme();
    const elapsed = (info.completedAt ?? Date.now()) - info.startedAt;
    const isDone =
        info.status === 'completed' ||
        info.status === 'failed' ||
        info.status === 'cancelled';

    const statusSymbol =
        info.status === 'completed'
            ? '✓'
            : info.status === 'failed'
              ? '✗'
              : info.status === 'cancelled'
                ? '⊘'
                : '◉';

    const statusColor =
        info.status === 'completed'
            ? colors.success
            : info.status === 'failed'
              ? colors.error
              : info.status === 'cancelled'
                ? colors.dimSeparator
                : colors.info;

    // Sort tools by count descending, take top 5
    const topTools = Object.entries(info.toolsUsed)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

    return (
        <box flexDirection="column" gap={0} width="100%">
            <box flexDirection="row" gap={1} alignItems="center" width="100%">
                <text fg={statusColor}>{statusSymbol}</text>
                <text>{info.task ?? 'Unknown task'}</text>
            </box>
            <box flexDirection="row" gap={1} paddingLeft={2} width="100%">
                <StepProgress
                    step={info.step}
                    maxSteps={info.maxSteps}
                    colors={colors}
                />
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    · {prettyMs(elapsed)}
                </text>
                {info.toolCallCount > 0 && (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={colors.dimSeparator}
                    >
                        · {info.toolCallCount} tool
                        {info.toolCallCount !== 1 ? 's' : ''}
                    </text>
                )}
            </box>
            {!isDone && info.currentTool && (
                <box flexDirection="row" gap={1} paddingLeft={2} width="100%">
                    <text attributes={TextAttributes.DIM} fg={colors.info}>
                        → {formatToolName(info.currentTool)}
                        {info.currentToolInput
                            ? ` ${info.currentToolInput}`
                            : ''}
                    </text>
                </box>
            )}
            {info.status === 'failed' && info.error && (
                <box flexDirection="row" gap={1} paddingLeft={2} width="100%">
                    <text attributes={TextAttributes.DIM} fg={colors.error}>
                        ✗ {info.error?.slice(0, 60) ?? ''}
                    </text>
                </box>
            )}
            {/* Show top tools in compact format */}
            {topTools.length > 0 && (
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
                    {Object.keys(info.toolsUsed).length > 5 && (
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            +{Object.keys(info.toolsUsed).length - 5} more
                        </text>
                    )}
                </box>
            )}
        </box>
    );
}

/**
 * Inline panel showing active subagent progress.
 * Matches the screenshot style: checkmarks, task names, tool call counts, durations.
 */
export const SubagentProgressPanel = React.memo(function SubagentProgressPanel({
    expanded = false,
    toolCallId,
}: SubagentProgressPanelProps) {
    const { colors } = useTheme();
    const [subagents, setSubagents] =
        useState<SubagentInfo[]>(getActiveSubagents());

    useEffect(() => {
        const unsub = onSubagentChange(() => {
            setSubagents(getActiveSubagents());
        });
        return unsub;
    }, []);

    // Filter to only the subagent spawned by this specific tool call
    const filtered = toolCallId
        ? subagents.filter((s) => {
              const subagentId = getSubagentForToolCall(toolCallId);
              return subagentId ? s.id === subagentId : false;
          })
        : subagents;

    if (filtered.length === 0) return null;

    const running = filtered.filter((s) => s.status === 'running');
    const completed = filtered.filter((s) => s.status === 'completed');
    const failed = filtered.filter(
        (s) => s.status === 'failed' || s.status === 'cancelled',
    );
    const totalToolCalls = filtered.reduce(
        (sum, s) => sum + s.toolCallCount,
        0,
    );

    // In compact mode, show each subagent with its current tool and top tools used
    if (!expanded) {
        return (
            <box flexDirection="column" gap={0} paddingLeft={2} paddingRight={2} width="100%">
                <box
                    flexDirection="column"
                    backgroundColor={colors.surface}
                    width="100%"
                    paddingX={1}
                >
                    {/* Summary header */}
                        {filtered.length > 1 && (
                            <box flexDirection="row" gap={1} width="100%">
                                <text
                                    attributes={TextAttributes.DIM}
                                    fg={colors.dimSeparator}
                                >
                                    {running.length > 0 &&
                                        `◉ ${running.length} running`}
                                    {running.length > 0 &&
                                        completed.length > 0 &&
                                        ' · '}
                                    {completed.length > 0 &&
                                        `✓ ${completed.length} done`}
                                    {completed.length > 0 && failed.length > 0 && ' · '}
                                    {failed.length > 0 && `✗ ${failed.length} failed`}
                                    {totalToolCalls > 0 && ` · ${totalToolCalls} tools`}
                                </text>
                            </box>
                        )}
                        {[...running, ...completed, ...failed].map((info) => {
                            const statusSymbol =
                                info.status === 'completed'
                                    ? '✓'
                                    : info.status === 'failed'
                                      ? '✗'
                                      : info.status === 'cancelled'
                                        ? '⊘'
                                        : '◉';
                            const statusColor =
                                info.status === 'completed'
                                    ? colors.success
                                    : info.status === 'failed'
                                      ? colors.error
                                      : info.status === 'cancelled'
                                        ? colors.dimSeparator
                                        : colors.info;
                            // Top 3 tools by count
                            const topTools = Object.entries(info.toolsUsed)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 3);
                            const totalTools = Object.keys(info.toolsUsed).length;

                            return (
                                <box
                                    key={info.id}
                                    flexDirection="column"
                                    gap={0}
                                    width="100%"
                                >
                                    <box flexDirection="row" gap={1} width="100%">
                                        <text fg={statusColor}>{statusSymbol}</text>
                                        {info.currentTool &&
                                        info.status === 'running' ? (
                                            <text
                                                attributes={TextAttributes.DIM}
                                                fg={colors.info}
                                            >
                                                {formatToolName(info.currentTool)}
                                                {info.currentToolInput
                                                    ? ` ${info.currentToolInput}`
                                                    : ''}
                                            </text>
                                        ) : topTools.length > 0 ? (
                                            <text
                                                attributes={TextAttributes.DIM}
                                                fg={colors.dimSeparator}
                                            >
                                                {topTools
                                                    .map(([t, c]) => `${t}×${c}`)
                                                    .join(' · ')}
                                                {totalTools > 3
                                                    ? ` +${totalTools - 3}`
                                                    : ''}
                                            </text>
                                        ) : info.status === 'completed' ? (
                                            <text
                                                attributes={TextAttributes.DIM}
                                                fg={colors.dimSeparator}
                                            >
                                                done
                                            </text>
                                        ) : info.status === 'failed' ? (
                                            <text
                                                attributes={TextAttributes.DIM}
                                                fg={colors.error}
                                            >
                                                failed
                                            </text>
                                        ) : null}
                            </box>
                        </box>
                    );
                })}
                </box>
            </box>
        );
    }

    // Expanded mode: full list with details
    return (
        <box
            flexDirection="column"
            gap={1}
            paddingLeft={3}
            paddingY={1}
            width="100%"
        >
            <box
                    flexDirection="column"
                    backgroundColor={colors.surface}
                    width="100%"
                    paddingX={1}
                    paddingY={1}
                >
                    {/* Summary header */}
                    <box flexDirection="row" gap={1} width="100%">
                        <text attributes={TextAttributes.BOLD}>Subagents:</text>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                            {running.length > 0 && `${running.length} running`}
                            {running.length > 0 && completed.length > 0 && ' · '}
                            {completed.length > 0 && `${completed.length} done`}
                            {completed.length > 0 && failed.length > 0 && ' · '}
                            {failed.length > 0 && `${failed.length} failed`}
                            {totalToolCalls > 0 && ` · ${totalToolCalls} total tools`}
                        </text>
                    </box>
                    {completed.map((info, i) => (
                        <SubagentRow key={`done-${info.id}`} info={info} index={i} />
                    ))}
                    {running.map((info, i) => (
                        <SubagentRow key={`run-${info.id}`} info={info} index={i} />
                    ))}
                    {failed.map((info, i) => (
                        <SubagentRow key={`fail-${info.id}`} info={info} index={i} />
                    ))}
                </box>
        </box>
    );
});
