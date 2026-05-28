import { TextAttributes } from "@opentui/core";
import { useTheme } from "@/providers/theme";
import { EmptyBorder } from "@/components/border";

type ErrorMessageProps = {
    message: string;
};

export function ErrorMessage({ message }: ErrorMessageProps) {
    const { colors } = useTheme();

    return (
        <box width="100%" alignItems="center">
            <box
                border={["left"]}
                borderColor={colors.error}
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
                    <text attributes={TextAttributes.DIM}>{message}</text>
                </box>
            </box>
        </box>
    );
}
