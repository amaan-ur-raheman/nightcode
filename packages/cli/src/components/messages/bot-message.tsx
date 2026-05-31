import { useTheme } from "@/providers/theme";
import { TextAttributes } from "@opentui/core";
import { Mode } from "@nightcode/database/enums";
import type { ClientMessagePart } from "@/hooks/use-chat";

type BotMessageProps = {
    parts: ClientMessagePart[];
    model: string;
    mode: Mode
    duration?: string;
    streaming?: boolean;
};

export function BotMessage({
    parts,
    model,
    mode,
    duration,
    streaming = false
}: BotMessageProps) {
    const { colors } = useTheme();
    const text = parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");

    return (
        <box alignItems="center" width="100%">
            <box paddingY={1} width="100%">
                <box paddingX={3} width="100%">
                    <text>{text}</text>
                </box>
            </box>

            <box paddingX={3} paddingBottom={1} gap={1} width="100%">
                <box flexDirection="row" gap={2}>
                    <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>◉</text>
                    <box flexDirection="row" gap={1}>
                        <text>{mode === Mode.PLAN ? "Plan" : "Build"}</text>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                             ›
                        </text>
                        <text attributes={TextAttributes.DIM}>{model}</text>
                        {duration && (
                            <>
                                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                                     ›
                                </text>
                                <text attributes={TextAttributes.DIM}>{duration}</text>
                            </>
                        )}
                    </box>
                </box>
            </box>
        </box>
    );
}
