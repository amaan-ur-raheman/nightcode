import { useTheme } from "@/providers/theme";
import { EmptyBorder } from "@/components/border";

type UserMessageProps = {
    message: string;
};

export function UserMessage({ message }: UserMessageProps) {
    const { colors } = useTheme();

    return (
        <box width="100%" alignItems="center">
            <box
                border={["left"]}
                borderColor={colors.primary}
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
