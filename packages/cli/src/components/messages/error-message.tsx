import React from 'react';

import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { MessageBox } from '@/components/message-box';

type ErrorMessageProps = {
    message: string;
    canRetry?: boolean;
};

export const ErrorMessage = React.memo(function ErrorMessage({
    message,
    canRetry,
}: ErrorMessageProps) {
    const { colors } = useTheme();

    return (
        <MessageBox borderColor={colors.error}>
            <text attributes={TextAttributes.DIM}>{message}</text>
            {canRetry && (
                <text fg={colors.info} attributes={TextAttributes.BOLD}>
                    {' '}
                    ⟳ retry (Ctrl+R)
                </text>
            )}
        </MessageBox>
    );
});
