import React from 'react';

import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { MessageBox } from '@/components/message-box';

type ErrorCategory =
    | 'network'
    | 'auth'
    | 'tool'
    | 'permission'
    | 'timeout'
    | 'unknown';

interface ErrorInfo {
    category: ErrorCategory;
    icon: string;
    suggestion: string;
    originalMessage: string;
    shortcuts?: string[];
}

function categorizeError(message: string): ErrorInfo {
    const lower = message.toLowerCase();

    if (
        lower.includes('network') ||
        lower.includes('fetch') ||
        lower.includes('econnrefused') ||
        lower.includes('socket')
    ) {
        return {
            category: 'network',
            icon: '✗',
            suggestion:
                'Check your internet connection or API endpoint availability',
            originalMessage: message,
            shortcuts: ['Ctrl+R: Retry', 'Ctrl+D: Toggle diagnostics'],
        };
    }

    if (
        lower.includes('unauthorized') ||
        lower.includes('401') ||
        lower.includes('invalid api key') ||
        lower.includes('authentication')
    ) {
        return {
            category: 'auth',
            icon: '✗',
            suggestion: 'Run /model to check your API key configuration',
            originalMessage: message,
            shortcuts: ['/model: Switch model', '/setup: Reconfigure'],
        };
    }

    if (
        lower.includes('rate limit') ||
        lower.includes('429') ||
        lower.includes('too many requests')
    ) {
        return {
            category: 'timeout',
            icon: '✗',
            suggestion: 'Rate limited — wait a moment before retrying',
            originalMessage: message,
            shortcuts: ['Ctrl+R: Retry after delay'],
        };
    }

    if (
        lower.includes('permission') ||
        lower.includes('eacces') ||
        lower.includes('denied') ||
        lower.includes('access')
    ) {
        return {
            category: 'permission',
            icon: '✗',
            suggestion:
                'Insufficient permissions — check file/folder access rights',
            originalMessage: message,
            shortcuts: ['/shell: Open terminal to fix permissions'],
        };
    }

    if (
        lower.includes('timeout') ||
        lower.includes('timed out') ||
        lower.includes('deadline')
    ) {
        return {
            category: 'timeout',
            icon: '✗',
            suggestion:
                'Operation timed out — try breaking the task into smaller steps',
            originalMessage: message,
            shortcuts: ['Ctrl+R: Retry', 'Ctrl+I: Interrupt'],
        };
    }

    if (
        lower.includes('tool') ||
        lower.includes('execution') ||
        lower.includes('command failed')
    ) {
        return {
            category: 'tool',
            icon: '✗',
            suggestion:
                'Tool execution failed — check the command or arguments',
            originalMessage: message,
            shortcuts: ['Ctrl+R: Retry with fixes', 'Ctrl+Z: Undo last change'],
        };
    }

    return {
        category: 'unknown',
        icon: '⚠',
        suggestion:
            message.length > 100 ? message.slice(0, 97) + '...' : message,
        originalMessage: message,
        shortcuts: ['Ctrl+R: Retry', '/help: Get assistance'],
    };
}

type ErrorMessageProps = {
    message: string;
    canRetry?: boolean;
    onRetry?: () => void;
};

export const ErrorMessage = React.memo(function ErrorMessage({
    message,
    canRetry,
    onRetry,
}: ErrorMessageProps) {
    const { colors } = useTheme();
    const errorInfo = categorizeError(message);

    const categoryColors: Record<ErrorCategory, string> = {
        network: colors.info,
        auth: colors.error,
        tool: colors.info,
        permission: colors.error,
        timeout: colors.info,
        unknown: colors.dimSeparator,
    };

    return (
        <MessageBox borderColor={categoryColors[errorInfo.category]}>
            <box flexDirection="column">
                <text>
                    {errorInfo.icon}{' '}
                    {errorInfo.category.toUpperCase()} error
                </text>

                <text attributes={TextAttributes.DIM} marginTop={1}>
                    {errorInfo.suggestion}
                </text>

                {errorInfo.originalMessage && (
                    <text attributes={TextAttributes.DIM} marginTop={1}>
                        {errorInfo.originalMessage.length > 100
                            ? errorInfo.originalMessage.slice(0, 97) + '...'
                            : errorInfo.originalMessage}
                    </text>
                )}

                {errorInfo.shortcuts && errorInfo.shortcuts.length > 0 && (
                    <box marginTop={1} flexDirection="column">
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            Quick actions:
                        </text>
                        {errorInfo.shortcuts.map((shortcut, i) => (
                            <text key={i} fg={colors.info}>
                                {'  '}
                                {shortcut}
                            </text>
                        ))}
                    </box>
                )}

                {canRetry && onRetry && (
                    <text
                        fg={colors.info}
                        attributes={TextAttributes.BOLD}
                        marginTop={1}
                        {...({ onClick: onRetry } as any)}
                    >
                        {'⟳ retry (Ctrl+R)'}
                    </text>
                )}
            </box>
        </MessageBox>
    );
});
