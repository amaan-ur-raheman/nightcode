import { useTheme } from "@/providers/theme";
import { Mode, type ModeType } from "@nightcode/shared";

import { EmptyBorder } from "@/components/border";

type UserMessageProps = {
    message: string;
    mode: ModeType;
};

export function UserMessage({ message, mode }: UserMessageProps) {
    const { colors } = useTheme();

    return (
        <box width="100%" alignItems="center">
            <box
                border={["left"]}
                borderColor={mode === Mode.BUILD ? colors.primary : colors.planMode}
                customBorderChars={{
                    ...EmptyBorder,
                    vertical: "┃",
                    bottomLeft: "╹",
                }}
                width="100%"
            >
                <box
                    justifyContent="center"
                    paddingX={2}
                    paddingY={1}
                    backgroundColor={colors.surface}
                    width="100%"
                >
                    <text>{message}</text>
                </box>
            </box>
        </box>
    );
}
