import React from "react";

import { TextAttributes } from "@opentui/core";
import { useTheme } from "@/providers/theme";

type OnboardingCardProps = {
    onDismiss: () => void;
};

export const OnboardingCard = React.memo(function OnboardingCard({ onDismiss }: OnboardingCardProps) {
    const { colors } = useTheme();

    return (
        <box
            flexDirection="column"
            gap={1}
            paddingX={2}
            paddingY={1}
            border={["top", "bottom", "left", "right"]}
            borderColor={colors.primary}
            width="100%"
        >
            <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                Welcome to NightCode!
            </text>
            <text attributes={TextAttributes.DIM}>
                Here are some quick tips to get started:
            </text>
            <box flexDirection="column" gap={0} paddingX={1}>
                <text>
                    <em fg={colors.info}>Tab</em> — Switch between Plan and Build mode
                </text>
                <text>
                    <em fg={colors.info}>/help</em> — See all available commands
                </text>
                <text>
                    <em fg={colors.info}>@filename</em> — Mention files in your prompt
                </text>
                <text>
                    <em fg={colors.info}>Ctrl+R</em> — Retry last message on error
                </text>
                <text>
                    <em fg={colors.info}>Esc</em> — Interrupt running generation
                </text>
            </box>
            <text
                attributes={TextAttributes.DIM}
                fg={colors.dimSeparator}
            >
                Press any key to dismiss
            </text>
        </box>
    );
});
