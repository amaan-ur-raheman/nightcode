import React, { useState, useCallback, useEffect, useRef } from 'react';

import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';

import { EmptyBorder } from '@/components/border';
import { KeyHint } from '@/components/key-hint';

import type { ConfirmationManager } from '@/lib/tools/dangerous-ops';

interface ToolConfirmationOverlayProps {
    manager: ConfirmationManager;
}

type Action = 'allow-once' | 'allow-always' | 'reject';

const ACTIONS: { key: Action; label: string }[] = [
    { key: 'allow-once', label: 'Allow once' },
    { key: 'allow-always', label: 'Allow always' },
    { key: 'reject', label: 'Reject' },
];

export function ToolConfirmationOverlay({
    manager,
}: ToolConfirmationOverlayProps) {
    const { colors } = useTheme();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const { push, pop, isTopLayer } = useKeyboardLayer();
    const pushedRef = useRef(false);
    const [requests, setRequests] = useState<
        Array<{
            id: string;
            toolName: string;
            reason: string;
            details: string;
            accessPath?: string;
            patterns?: string[];
        }>
    >(() => Array.from(manager.pending.values()));

    useEffect(() => {
        // Sync from manager on every change (covers late subscriptions)
        setRequests(Array.from(manager.pending.values()));
        return manager.onChange(() => {
            setRequests(Array.from(manager.pending.values()));
        });
    }, [manager]);

    const request = requests[0] ?? null;

    // Push keyboard layer when request is active
    useEffect(() => {
        if (request && !pushedRef.current) {
            push('confirmation', () => {
                manager.cancel(request.id);
                return true;
            });
            pushedRef.current = true;
            setSelectedIndex(0);
        } else if (!request && pushedRef.current) {
            pop('confirmation');
            pushedRef.current = false;
        }
    }, [request, push, pop, manager]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pushedRef.current) {
                pop('confirmation');
                pushedRef.current = false;
            }
        };
    }, [pop]);

    const handleAction = useCallback(
        (action: Action) => {
            if (!request) return;

            switch (action) {
                case 'allow-once':
                    manager.confirm(request.id);
                    break;
                case 'allow-always':
                    manager.confirmAlways(request.id);
                    break;
                case 'reject':
                    manager.cancel(request.id);
                    break;
            }
        },
        [request, manager],
    );

    useKeyboard((key) => {
        if (!request || !isTopLayer('confirmation')) return;

        if (key.name === 'tab') {
            key.preventDefault();
            setSelectedIndex((i) => (i + 1) % ACTIONS.length);
            return;
        }

        if (key.name === 'escape') {
            key.preventDefault();
            handleAction('reject');
            return;
        }

        if (key.name === 'return' || key.name === 'enter') {
            key.preventDefault();
            const action = ACTIONS[selectedIndex];
            if (action) {
                handleAction(action.key);
            }
            return;
        }
    });

    if (!request) return null;

    return (
        <box
            flexDirection="column"
            width="100%"
            border={['left']}
            borderColor={colors.error}
            customBorderChars={{
                ...EmptyBorder,
                vertical: '┃',
                bottomLeft: '╹',
            }}
        >
            <box
                flexDirection="column"
                paddingX={2}
                paddingY={1}
                backgroundColor={colors.surface}
                width="100%"
                gap={1}
            >
                {/* Header */}
                <box flexDirection="column" gap={0}>
                    <text fg={colors.error} attributes={TextAttributes.BOLD}>
                        {'⚠ Permission required'}
                    </text>
                    {request.accessPath ? (
                        <box flexDirection="row">
                            <text fg={colors.text}>
                                {'  ↳ '}
                                {request.reason}{' '}
                            </text>
                            <text fg={colors.dimSeparator}>
                                {request.accessPath}
                            </text>
                        </box>
                    ) : (
                        <text fg={colors.text}>
                            {'  ↳ '}
                            {request.reason}
                        </text>
                    )}
                </box>

                {/* Patterns */}
                {request.patterns && request.patterns.length > 0 && (
                    <box flexDirection="column" gap={0}>
                        <text
                            fg={colors.dimSeparator}
                            attributes={TextAttributes.DIM}
                        >
                            Patterns
                        </text>
                        {request.patterns.map((pattern, i) => (
                            <text key={`pattern-${i}`} fg={colors.text}>
                                {'- '}
                                {pattern}
                            </text>
                        ))}
                    </box>
                )}

                {/* Action buttons and hints */}
                <box
                    flexDirection="row"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    <box flexDirection="row" gap={2}>
                        {ACTIONS.map((action, i) => {
                            const isSelected = i === selectedIndex;
                            return (
                                <text
                                    key={action.key}
                                    attributes={
                                        isSelected
                                            ? TextAttributes.BOLD
                                            : undefined
                                    }
                                    fg={
                                        isSelected
                                            ? action.key === 'reject'
                                                ? colors.error
                                                : colors.success
                                            : colors.dimSeparator
                                    }
                                >
                                    {isSelected
                                        ? `[${action.label}]`
                                        : action.label}
                                </text>
                            );
                        })}
                    </box>
                    <box flexDirection="row" gap={2}>
                        <KeyHint keyName="⇥" label="select" />
                        <KeyHint keyName="enter" label="confirm" />
                    </box>
                </box>
            </box>
        </box>
    );
}
