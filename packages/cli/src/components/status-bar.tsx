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

type StatusBarProps = {
    messageCount?: number;
    sessionTitle?: string;
};

export const StatusBar = React.memo(function StatusBar({
    messageCount,
    sessionTitle,
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
            </box>
            <box flexDirection="row" gap={2}>
                {queueStats.queueSize > 0 || queueStats.running > 0 ? (
                    <text
                        attributes={TextAttributes.DIM}
                        fg={queueStats.rateLimited ? colors.error : colors.info}
                    >
                        {queueStats.queueSize > 0
                            ? `q:${queueStats.queueSize}`
                            : `q:${queueStats.running} run`}
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
                            ? `◉ ${activeSubagents} subagent${activeSubagents !== 1 ? 's' : ''}`
                            : `✓ ${completedSubagents} subagent${completedSubagents !== 1 ? 's' : ''}`}
                        {subagentToolCalls > 0
                            ? ` · ${subagentToolCalls} tools`
                            : ''}
                    </text>
                ) : null}
                {orchestrationCount > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.info}>
                        {`${orchestrationCount} orchestrat${orchestrationCount !== 1 ? 'ions' : 'ion'}`}
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
