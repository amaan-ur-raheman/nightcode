import React from "react";

import { useTheme } from "@/providers/theme";
import { type ModeType } from "@nightcode/shared";

import { MessageBox } from "@/components/message-box";
import { getModeColor } from "@/lib/mode-utils";

type UserMessageProps = {
    message: string;
    mode: ModeType;
};

export const UserMessage = React.memo(function UserMessage({ message, mode }: UserMessageProps) {
    const { colors } = useTheme();

    return (
        <MessageBox borderColor={getModeColor(mode, colors)}>
            <text>{message}</text>
        </MessageBox>
    );
});
