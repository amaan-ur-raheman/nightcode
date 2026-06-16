import React from 'react';
import { TextAttributes } from '@opentui/core';
import { appendFileSync } from 'fs';

type ErrorBoundaryProps = {
    children: React.ReactNode;
};

type ErrorBoundaryState = {
    error: Error | null;
};

const FALLBACK_COLORS = {
    error: '#f38ba8',
    text: '#cdd6f4',
    primary: '#89b4fa',
    dimSeparator: '#585b70',
};

export class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    override state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        try {
            appendFileSync(
                '/tmp/nightcode-error.log',
                `[${new Date().toISOString()}]\n${error.stack || error.message}\nReact Stack:\n${errorInfo.componentStack}\n\n`,
            );
        } catch {
            /* ignore */
        }
    }

    resetError = () => {
        this.setState({ error: null });
    };

    override render() {
        if (this.state.error) {
            const err = this.state.error;
            return <ErrorFallback error={err} onRetry={this.resetError} />;
        }

        return this.props.children;
    }
}

function ErrorFallback({
    error,
    onRetry,
}: {
    error: Error;
    onRetry: () => void;
}) {
    const msg = String(error?.message ?? 'Unknown error');

    React.useEffect(() => {
        const handler = (
            _data: Buffer,
            key?: { name?: string; ctrl?: boolean },
        ) => {
            if (key?.name === 'r' && !key?.ctrl) {
                onRetry();
            } else if (key?.name === 'q' || (key?.name === 'c' && key?.ctrl)) {
                process.exit(1);
            }
        };
        process.stdin.on('data', handler);
        process.stdin.setRawMode?.(true);
        return () => {
            process.stdin.off('data', handler);
        };
    }, [onRetry]);

    return (
        <box flexDirection="column" padding={1} gap={1}>
            <text attributes={TextAttributes.BOLD} fg={FALLBACK_COLORS.error}>
                {'NightCode encountered an error'}
            </text>
            <text fg={FALLBACK_COLORS.text}>{msg}</text>
            <text> </text>
            <text
                attributes={TextAttributes.DIM}
                fg={FALLBACK_COLORS.dimSeparator}
            >
                {'[r] Try again  [q] Quit  [Ctrl+C] Force quit'}
            </text>
        </box>
    );
}
