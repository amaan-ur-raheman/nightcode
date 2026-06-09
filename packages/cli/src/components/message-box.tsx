import type { ReactNode } from "react";

import { useTheme } from "@/providers/theme";
import { EmptyBorder } from "@/components/border";

type MessageBoxProps = {
    children: ReactNode;
    borderColor: string;
};

const ThickBorderChars = {
    ...EmptyBorder,
    vertical: "┃",
    bottomLeft: "╹",
};

export function MessageBox({ children, borderColor }: MessageBoxProps) {
    const { colors } = useTheme();

    return (
        <box width="100%" alignItems="center">
            <box
                border={["left"]}
                borderColor={borderColor}
                customBorderChars={ThickBorderChars}
                width="100%"
            >
                <box
                    justifyContent="center"
                    paddingX={2}
                    paddingY={1}
                    backgroundColor={colors.surface}
                    width="100%"
                >
                    {children}
                </box>
            </box>
        </box>
    );
}
