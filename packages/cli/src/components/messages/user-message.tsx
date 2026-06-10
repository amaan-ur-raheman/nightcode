import React from "react";

import { TextAttributes } from "@opentui/core";
import { useTheme } from "@/providers/theme";
import { type ModeType } from "@nightcode/shared";

import { MessageBox } from "@/components/message-box";
import { getModeColor } from "@/lib/mode-utils";

type UserMessageProps = {
    message: string;
    mode: ModeType;
    imageCount?: number;
};

export const UserMessage = React.memo(function UserMessage({ message, mode, imageCount = 0 }: UserMessageProps) {
    const { colors } = useTheme();

    return (
        <MessageBox borderColor={getModeColor(mode, colors)}>
            {imageCount > 0 && (
                <box flexDirection="row" gap={1} flexWrap="wrap" marginBottom={0}>
                    {Array.from({ length: imageCount }, (_, i) => (
                        <text key={`img-${i}`} attributes={TextAttributes.DIM}>
                            {`[Attached image ${i + 1}]`}
                        </text>
                    ))}
                </box>
            )}
            <text>{message}</text>
        </MessageBox>
    );
});
