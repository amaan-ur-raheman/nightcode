import React, { useState } from 'react';

import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { usePromptConfig } from '@/providers/prompt-config';
import { getModeColor } from '@/lib/mode-utils';
import { getModelName } from '@/lib/model-names';
import {
    getActiveSubagents,
    onSubagentChange,
    type SubagentInfo,
} from '@/lib/subagent-progress';
import { requestQueue, type QueueStats } from '@/lib/request-queue';
import { orchestratorManager } from '@/lib/orchestrator-manager';
import { getContextWindow } from '@/lib/model-context-windows';

type StatusBarProps = {
    messageCount?: number;
    sessionTitle?: string;
    messages?: any[];
    isLoading?: boolean;
    lastLatencyMs?: number | null;
    streamingTokens?: number;
    streamingStartTime?: number | null;
};

export const StatusBar = React.memo(function StatusBar({
    messageCount,
    sessionTitle,
    messages = [],
    isLoading = false,
    lastLatencyMs,
    streamingTokens = 0,
    streamingStartTime,
}: StatusBarProps) {
    const { mode, model } = usePromptConfig();
    const { colors } = useTheme();
    const [subagentSnapshot, setSubagentSnapshot] = useState<SubagentInfo[]>(
        [],
    );
    React.useEffect(() => {
        setSubagentSnapshot(getActiveSubagents());
        return onSubagentChange(() => {
            setSubagentSnapshot(getActiveSubagents());
        });
    }, []);

    const [queueStats, setQueueStats] = React.useState<QueueStats>(
        requestQueue.getStats(),
    );
    React.useEffect(() => {
        return requestQueue.onStatsChange(setQueueStats);
    }, []);

    const [orchestrationCount, setOrchestrationCount] = useState<number>(0);
    React.useEffect(() => {
        const unsubscribe = orchestratorManager.subscribe(() => {
            setOrchestrationCount(orchestratorManager.getAll().length);
        });
        return unsubscribe;
    }, []);

    // Activity indicator
    const activeSubagents = subagentSnapshot.filter(
        (s) => s.status === 'running',
    ).length;
    const hasActiveTasks =
        activeSubagents > 0 || orchestrationCount > 0 || queueStats.running > 0;

    // Spinner for active tasks
    const [spinnerIdx, setSpinnerIdx] = useState(0);
    React.useEffect(() => {
        if (!hasActiveTasks) return;
        const interval = setInterval(() => {
            setSpinnerIdx((prev) => (prev + 1) % 6);
        }, 120);
        return () => clearInterval(interval);
    }, [hasActiveTasks]);

    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴'];
    const taskSpinner = spinnerFrames[spinnerIdx] || '⠋';

    // Token cost estimation
    let inputTokens = 0;
    let outputTokens = 0;
    let lastDurationMs: number | undefined = undefined;

    for (const msg of messages) {
        let textLen = 0;
        if (msg.parts && Array.isArray(msg.parts)) {
            for (const part of msg.parts) {
                if (part.type === 'text' && typeof part.text === 'string') {
                    textLen += part.text.length;
                } else if (part.type === 'tool_call' && part.input) {
                    textLen += JSON.stringify(part.input).length;
                } else if (part.type === 'tool_result' && part.output) {
                    textLen += JSON.stringify(part.output).length;
                }
            }
        }
        const estTokens = Math.ceil(textLen / 4);
        if (msg.role === 'user') {
            inputTokens += estTokens;
        } else {
            outputTokens += estTokens;
            if (msg.metadata && msg.metadata.durationMs) {
                lastDurationMs = msg.metadata.durationMs;
            }
        }
    }

    const cost =
        (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;
    const contextWindow = getContextWindow(model);
    const totalTokens = inputTokens + outputTokens;
    const contextUsagePercent = Math.min(
        100,
        Math.round((totalTokens / contextWindow) * 100),
    );
    const isContextHigh = contextUsagePercent > 80;
    const isContextCritical = contextUsagePercent > 95;

    // Streaming stats
    let streamingSpeed = 0;
    if (isLoading && streamingStartTime && streamingTokens > 0) {
        const streamingElapsed = Date.now() - streamingStartTime;
        if (streamingElapsed > 0) {
            streamingSpeed = Math.round(
                (streamingTokens / streamingElapsed) * 1000,
            );
        }
    }

    // Build activity label
    let activityLabel: string | null = null;
    if (hasActiveTasks) {
        const parts: string[] = [];
        if (activeSubagents > 0)
            parts.push(`${activeSubagents} agent${activeSubagents !== 1 ? 's' : ''}`);
        if (orchestrationCount > 0)
            parts.push(`${orchestrationCount} orch`);
        if (queueStats.running > 0 || queueStats.queueSize > 0)
            parts.push(`q:${queueStats.running || queueStats.queueSize}`);
        activityLabel = parts.join(' · ');
    }

    return (
        <box
            flexDirection="row"
            gap={1}
            justifyContent="space-between"
            width="100%"
        >
            {/* Primary: mode + model */}
            <box flexDirection="row" gap={1}>
                <text fg={getModeColor(mode, colors)}>
                    {mode === 'PLAN' ? 'Plan' : 'Build'}
                </text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    ›
                </text>
                <text>{getModelName(model)}</text>
                {sessionTitle ? (
                    <>
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            ›
                        </text>
                        <text attributes={TextAttributes.DIM}>
                            {sessionTitle}
                        </text>
                    </>
                ) : null}
            </box>

            {/* Secondary: activity, latency, cost, ctx%, streaming */}
            <box flexDirection="row" gap={2}>
                {activityLabel ? (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={queueStats.rateLimited ? colors.error : colors.info}
                    >
                        {`${taskSpinner} ${activityLabel}`}
                    </text>
                ) : null}
                {!isLoading && lastLatencyMs != null && lastLatencyMs > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.muted}>
                        {lastLatencyMs >= 1000
                            ? `${(lastLatencyMs / 1000).toFixed(1)}s`
                            : `${lastLatencyMs}ms`}
                    </text>
                ) : null}
                {isLoading && streamingTokens > 0 && streamingSpeed > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.muted}>
                        {`${streamingSpeed} tx/s`}
                    </text>
                ) : null}
                {cost > 0 && (
                    <text attributes={TextAttributes.DIM} fg={colors.muted}>
                        {`$${cost.toFixed(4)}`}
                    </text>
                )}
                {totalTokens > 0 && (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={
                            isContextCritical
                                ? colors.error
                                : isContextHigh
                                  ? colors.info
                                  : colors.muted
                        }
                    >
                        {`ctx: ${contextUsagePercent}%`}
                    </text>
                )}
            </box>
        </box>
    );
});
