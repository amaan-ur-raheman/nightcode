import React, { useState } from 'react';

import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { usePromptConfig } from '@/providers/prompt-config';
import { getModeColor } from '@/lib/mode-utils';
import {
    getModelName,
    getProviderDisplayName,
    extractProvider,
} from '@/lib/model-names';
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
    /** Real-time token count during streaming */
    streamingTokens?: number;
    /** Timestamp when streaming started (for calculating tokens/sec) */
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
    const activeSubagents = subagentSnapshot.filter(
        (s) => s.status === 'running',
    ).length;
    const completedSubagents = subagentSnapshot.filter(
        (s) => s.status === 'completed',
    ).length;
    const subagentToolCalls = subagentSnapshot.reduce(
        (sum, s) => sum + s.toolCallCount,
        0,
    );
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

    // Rotating task spinner for parallel tasks
    const [spinnerIdx, setSpinnerIdx] = useState(0);
    const hasActiveTasks =
        activeSubagents > 0 || orchestrationCount > 0 || queueStats.running > 0;

    React.useEffect(() => {
        if (!hasActiveTasks) return;
        const interval = setInterval(() => {
            setSpinnerIdx((prev) => (prev + 1) % 6);
        }, 120);
        return () => clearInterval(interval);
    }, [hasActiveTasks]);

    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴'];
    const taskSpinner = spinnerFrames[spinnerIdx] || '⠋';

    // Token count, cost and latency estimation
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

    // Cost estimation: Input $3.00 / M tokens, Output $15.00 / M tokens
    const cost =
        (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;

    // Context window usage
    const contextWindow = getContextWindow(model);
    const totalTokens = inputTokens + outputTokens;
    const contextUsagePercent = Math.min(
        100,
        Math.round((totalTokens / contextWindow) * 100),
    );
    const isContextHigh = contextUsagePercent > 80;
    const isContextCritical = contextUsagePercent > 95;

    let latencyStr = '';
    const finalDurationMs = lastLatencyMs ?? lastDurationMs;
    if (!isLoading && finalDurationMs != null) {
        latencyStr =
            finalDurationMs >= 1000
                ? `${(finalDurationMs / 1000).toFixed(1)}s`
                : `${finalDurationMs}ms`;
    }

    // Streaming stats: tokens/sec and estimated time remaining
    let streamingSpeed = 0;
    let streamingElapsed = 0;
    if (isLoading && streamingStartTime && streamingTokens > 0) {
        streamingElapsed = Date.now() - streamingStartTime;
        if (streamingElapsed > 0) {
            streamingSpeed = Math.round(
                (streamingTokens / streamingElapsed) * 1000,
            );
        }
    }

    const userMessages = messageCount != null ? messageCount : 0;

    return (
        <box
            flexDirection="row"
            gap={1}
            justifyContent="space-between"
            width="100%"
        >
            <box flexDirection="row" gap={1}>
                <text fg={getModeColor(mode, colors)}>
                    {mode === 'PLAN' ? 'Plan' : 'Build'}
                </text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    ›
                </text>
                <text>{getModelName(model)}</text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    {getProviderDisplayName(extractProvider(model))}
                </text>
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
                {latencyStr ? (
                    <>
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            ›
                        </text>
                        <text>{latencyStr}</text>
                    </>
                ) : null}
                {isLoading && streamingTokens > 0 && streamingSpeed > 0 ? (
                    <>
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            ›
                        </text>
                        <text fg={colors.info}>
                            {`${streamingTokens.toLocaleString()} tx · ${streamingSpeed} tx/s`}
                        </text>
                    </>
                ) : null}
            </box>
            <box flexDirection="row" gap={2}>
                {cost > 0 && (
                    <text attributes={TextAttributes.DIM} fg={colors.success}>
                        {`$${cost.toFixed(4)} (${(inputTokens + outputTokens).toLocaleString()} tx)`}
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
                                  : colors.dimSeparator
                        }
                    >
                        {`ctx: ${contextUsagePercent}%`}
                    </text>
                )}
                {queueStats.queueSize > 0 || queueStats.running > 0 ? (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={queueStats.rateLimited ? colors.error : colors.info}
                    >
                        {queueStats.queueSize > 0
                            ? `q:${queueStats.queueSize}`
                            : `${taskSpinner} q:${queueStats.running} run`}
                    </text>
                ) : null}
                {activeSubagents > 0 || completedSubagents > 0 ? (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={
                            activeSubagents > 0
                                ? colors.info
                                : colors.dimSeparator
                        }
                    >
                        {activeSubagents > 0
                            ? `${taskSpinner} ${activeSubagents} subagent${activeSubagents !== 1 ? 's' : ''}`
                            : `✓ ${completedSubagents} subagent${completedSubagents !== 1 ? 's' : ''}`}
                        {subagentToolCalls > 0
                            ? ` · ${subagentToolCalls} tools`
                            : ''}
                    </text>
                ) : null}
                {orchestrationCount > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.info}>
                        {`${taskSpinner} ${orchestrationCount} orchestrat${orchestrationCount !== 1 ? 'ions' : 'ion'}`}
                    </text>
                ) : null}
                {userMessages > 0 ? (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={colors.dimSeparator}
                    >
                        {`${userMessages} msg${userMessages !== 1 ? 's' : ''}`}
                    </text>
                ) : null}
            </box>
        </box>
    );
});
