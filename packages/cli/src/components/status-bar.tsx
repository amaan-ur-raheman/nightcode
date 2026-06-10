import React, { useSyncExternalStore, useEffect, useState } from "react";

import { TextAttributes } from "@opentui/core";

import { useTheme } from "@/providers/theme";
import { usePromptConfig } from "@/providers/prompt-config";
import { useCredits } from "@/hooks/use-credits";
import { getModeColor } from "@/lib/mode-utils";
import { getModelName } from "@/lib/model-names";
import { getActiveSubagentCount, onSubagentChange } from "@/lib/subagent-progress";
import { requestQueue, type QueueStats } from "@/lib/request-queue";
import { toolAnalytics } from "@/lib/tool-analytics";

type TokenUsage = {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    hasActivity: boolean;
};

type StatusBarProps = {
    messageCount?: number;
    sessionTitle?: string;
    tokenUsage?: TokenUsage;
};

export const StatusBar = React.memo(function StatusBar({ messageCount, sessionTitle, tokenUsage }: StatusBarProps) {
    const { mode, model } = usePromptConfig();
    const { colors } = useTheme();
    const { balance, loading } = useCredits();
    const activeSubagents = useSyncExternalStore(
        onSubagentChange,
        getActiveSubagentCount,
        getActiveSubagentCount,
    );
    const [queueStats, setQueueStats] = React.useState<QueueStats>(requestQueue.getStats());

    React.useEffect(() => {
        return requestQueue.onStatsChange(setQueueStats);
    }, []);
    const [toolCalls, setToolCalls] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        let timeoutId: any = null;

        async function poll() {
            try {
                const stats = await toolAnalytics.getStats();
                if (!cancelled) {
                    setToolCalls(stats.totalCalls);
                }
            } catch {
                // ignore
            } finally {
                if (!cancelled) {
                    timeoutId = setTimeout(poll, 5000);
                }
            }
        }

        poll();

        return () => {
            cancelled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, []);

    const userMessages = messageCount != null ? messageCount : 0;

    return (
        <box flexDirection="row" gap={1} justifyContent="space-between" width="100%">
            <box flexDirection="row" gap={1}>
                <text fg={getModeColor(mode, colors)}>
                    {mode === "PLAN" ? "Plan" : "Build"}
                </text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    ›
                </text>
                <text>{getModelName(model)}</text>
                {sessionTitle ? (
                    <>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                            ›
                        </text>
                        <text attributes={TextAttributes.DIM}>{sessionTitle}</text>
                    </>
                ) : null}
            </box>
            <box flexDirection="row" gap={2}>
                {(queueStats.queueSize > 0 || queueStats.running > 0) ? (
                    <text attributes={TextAttributes.DIM} fg={queueStats.rateLimited ? colors.error : colors.info}>
                        {queueStats.queueSize > 0
                            ? `q:${queueStats.queueSize}`
                            : `q:${queueStats.running} run`}
                    </text>
                ) : null}
                {activeSubagents > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.info}>
                        {`${activeSubagents} subagent${activeSubagents !== 1 ? "s" : ""}`}
                    </text>
                ) : null}
                {toolCalls != null && toolCalls > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                        {`${toolCalls} tool${toolCalls !== 1 ? "s" : ""}`}
                    </text>
                ) : null}
                {userMessages > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                        {`${userMessages} msg${userMessages !== 1 ? "s" : ""}`}
                    </text>
                ) : null}
                {tokenUsage?.hasActivity ? (
                    <text attributes={TextAttributes.DIM} fg={colors.info}>
                        {`~$${tokenUsage.totalCost.toFixed(2)}`}
                    </text>
                ) : null}
                {!loading && (
                    <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                        {balance != null ? `${balance.toLocaleString()} credits` : "—"}
                    </text>
                )}
            </box>
        </box>
    );
});
