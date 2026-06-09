import React, { useSyncExternalStore } from "react";

import { TextAttributes } from "@opentui/core";

import { useTheme } from "@/providers/theme";
import { usePromptConfig } from "@/providers/prompt-config";
import { useCredits } from "@/hooks/use-credits";
import { getModeColor } from "@/lib/mode-utils";
import { getModelName } from "@/lib/model-names";
import { getActiveSubagentCount, onSubagentChange } from "@/lib/subagent-progress";

type StatusBarProps = {
    messageCount?: number;
    sessionTitle?: string;
};

export const StatusBar = React.memo(function StatusBar({ messageCount, sessionTitle }: StatusBarProps) {
    const { mode, model } = usePromptConfig();
    const { colors } = useTheme();
    const { balance, loading } = useCredits();
    const activeSubagents = useSyncExternalStore(
        onSubagentChange,
        getActiveSubagentCount,
        getActiveSubagentCount,
    );

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
                {activeSubagents > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.info}>
                        {`${activeSubagents} subagent${activeSubagents !== 1 ? "s" : ""}`}
                    </text>
                ) : null}
                {userMessages > 0 ? (
                    <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                        {`${userMessages} msg${userMessages !== 1 ? "s" : ""}`}
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
