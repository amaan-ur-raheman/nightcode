import React from 'react';

import { useKeyboard } from '@opentui/react';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

type ConfirmDialogProps = {
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
};

export function ConfirmDialog({
    message,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const { isTopLayer } = useKeyboardLayer();
    const { colors } = useTheme();

    useKeyboard((key) => {
        if (!isTopLayer('confirm')) return;

        if (key.name === 'y' || key.name === 'return') {
            key.preventDefault();
            onConfirm();
        } else if (key.name === 'n' || key.name === 'escape') {
            key.preventDefault();
            onCancel();
        }
    });

    return (
        <box flexDirection="column" gap={1} padding={1}>
            <text fg={colors.text}>{message}</text>
            <box>
                <text attributes={TextAttributes.BOLD} fg={colors.success}>
                    y
                </text>
                <text fg={colors.dimSeparator}> / </text>
                <text attributes={TextAttributes.BOLD} fg={colors.error}>
                    n
                </text>
            </box>
        </box>
    );
}
