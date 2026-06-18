import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';

type KeyHintProps = {
    keyName: string;
    label: string;
};

export function KeyHint({ keyName, label }: KeyHintProps) {
    const { colors } = useTheme();
    return (
        <>
            <text fg={colors.muted}>{keyName}</text>
            <text attributes={TextAttributes.DIM}>{label}</text>
        </>
    );
}
