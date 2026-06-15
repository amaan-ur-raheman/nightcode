import React, { useState, useEffect, useRef } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import {
    timelineManager,
    type Snapshot,
    type TimelineData,
} from '@/lib/timeline-manager';
import { Spinner } from '@/components/spinner';
import { apiClient } from '@/lib/api-client';

type TimelineDialogContentProps = {
    sessionId: string;
    messages?: any[];
    onRollback: (commitHash: string, branchId?: string) => void;
};

export function TimelineDialogContent({
    sessionId,
    messages,
    onRollback,
}: TimelineDialogContentProps) {
    const { colors } = useTheme();
    const dimensions = useTerminalDimensions();
    const { isTopLayer, push, pop } = useKeyboardLayer();

    const [loading, setLoading] = useState(false);
    const [timeline, setTimeline] = useState<TimelineData | null>(null);
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [columnFocus, setColumnFocus] = useState<'list' | 'diff'>('list');
    const [diffContent, setDiffContent] = useState<string>('');
    const [diffScrollTop, setDiffScrollTop] = useState(0);
    const [confirmRollback, setConfirmRollback] = useState(false);
    const [messagesList, setMessagesList] = useState<any[]>(messages ?? []);

    const diffScrollRef = useRef<any>(null);

    // Push keyboard layer
    useEffect(() => {
        push('timeline', () => true);
        return () => {
            pop('timeline');
        };
    }, [push, pop]);

    // Load timeline and match with messages
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                let currentMessages = messagesList;
                if (currentMessages.length === 0) {
                    const res = await apiClient.sessions[':id'].$get({
                        param: { id: sessionId },
                    });
                    if (res.ok) {
                        const sessionData = await res.json();
                        const fetchedMessages =
                            sessionData.messages as unknown as any[];
                        currentMessages = fetchedMessages;
                        setMessagesList(fetchedMessages);
                    }
                }

                const data = await timelineManager.loadTimeline(sessionId);
                setTimeline(data);

                // Filter messages that have a snapshot commit
                const list: Snapshot[] = [];
                for (const msg of currentMessages) {
                    const snap = data.snapshots[msg.id];
                    if (snap) {
                        list.push(snap);
                    }
                }
                // Sort by timestamp descending
                list.sort(
                    (a, b) =>
                        new Date(b.timestamp).getTime() -
                        new Date(a.timestamp).getTime(),
                );
                setSnapshots(list);
            } catch (e) {
                // ignore
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [sessionId, messages?.length]);

    const activeSnapshot = snapshots[selectedIndex];

    // Load diff for active snapshot
    useEffect(() => {
        if (!activeSnapshot) {
            setDiffContent('');
            return;
        }
        let ignore = false;
        const fetchDiff = async () => {
            const diff = await timelineManager.getDiff(
                activeSnapshot.commitHash,
            );
            if (!ignore) {
                setDiffContent(diff);
                setDiffScrollTop(0);
                if (diffScrollRef.current) {
                    diffScrollRef.current.scrollTo(0);
                }
            }
        };
        fetchDiff();
        return () => {
            ignore = true;
        };
    }, [activeSnapshot]);

    const handleConfirmRollback = async () => {
        if (!activeSnapshot) return;
        setLoading(true);
        try {
            const success = await timelineManager.rollbackTo(
                activeSnapshot.commitHash,
            );
            if (success) {
                onRollback(activeSnapshot.commitHash);
            }
        } catch (e) {
            // ignore
        } finally {
            setLoading(false);
        }
    };

    const keyHandlerRef = useRef<((key: any) => void) | undefined>(undefined);
    keyHandlerRef.current = (key) => {
        if (!isTopLayer('timeline') || loading) return;

        if (confirmRollback) {
            if (
                key.name === 'y' ||
                key.name === 'return' ||
                key.name === 'enter'
            ) {
                key.preventDefault();
                setConfirmRollback(false);
                handleConfirmRollback();
            } else if (key.name === 'n' || key.name === 'escape') {
                key.preventDefault();
                setConfirmRollback(false);
            }
            return;
        }

        if (key.name === 'r') {
            key.preventDefault();
            if (activeSnapshot) {
                setConfirmRollback(true);
            }
            return;
        }

        // Column Focus Toggle
        if (key.name === 'left') {
            key.preventDefault();
            if (columnFocus === 'diff') {
                setColumnFocus('list');
            }
        } else if (key.name === 'right') {
            key.preventDefault();
            if (columnFocus === 'list') {
                setColumnFocus('diff');
            }
        }

        // Vertical Navigation / Scrolling
        if (key.name === 'up') {
            key.preventDefault();
            if (columnFocus === 'list') {
                setSelectedIndex((prev) =>
                    prev > 0 ? prev - 1 : snapshots.length - 1,
                );
            } else {
                const newTop = Math.max(0, diffScrollTop - 1);
                setDiffScrollTop(newTop);
                if (diffScrollRef.current) {
                    diffScrollRef.current.scrollTo(newTop);
                }
            }
        } else if (key.name === 'down') {
            key.preventDefault();
            if (columnFocus === 'list') {
                setSelectedIndex((prev) =>
                    prev < snapshots.length - 1 ? prev + 1 : 0,
                );
            } else {
                const newTop = diffScrollTop + 1;
                setDiffScrollTop(newTop);
                if (diffScrollRef.current) {
                    diffScrollRef.current.scrollTo(newTop);
                }
            }
        }
    };

    useKeyboard((key) => {
        keyHandlerRef.current?.(key);
    });

    if (loading) {
        return (
            <box
                flexDirection="column"
                gap={1}
                padding={2}
                alignItems="center"
                justifyContent="center"
                height={15}
            >
                <Spinner mode="BUILD" />
                <text fg={colors.text}>Processing time travel...</text>
            </box>
        );
    }

    if (confirmRollback && activeSnapshot) {
        return (
            <box
                flexDirection="column"
                gap={1}
                padding={2}
                alignItems="center"
                justifyContent="center"
                height={15}
            >
                <text fg={colors.error} attributes={TextAttributes.BOLD}>
                    Confirm Rollback
                </text>
                <text fg={colors.text}>
                    Are you sure you want to rollback workspace files to commit:
                </text>
                <text fg={colors.primary} attributes={TextAttributes.BOLD}>
                    {activeSnapshot.commitHash.substring(0, 10)}
                </text>
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    (This will overwrite any uncommitted changes in your
                    directory!)
                </text>
                <box marginTop={1} flexDirection="row" gap={2}>
                    <text fg={colors.success} attributes={TextAttributes.BOLD}>
                        [y] Yes
                    </text>
                    <text fg={colors.error} attributes={TextAttributes.BOLD}>
                        [n] No
                    </text>
                </box>
            </box>
        );
    }

    if (snapshots.length === 0) {
        return (
            <box
                flexDirection="column"
                gap={1}
                padding={2}
                alignItems="center"
                justifyContent="center"
                height={12}
            >
                <text fg={colors.error} attributes={TextAttributes.BOLD}>
                    No Snapshots Available
                </text>
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    Snapshots are automatically created when the assistant
                    completes replies.
                </text>
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    Try sending a message first to generate a checkpoint.
                </text>
            </box>
        );
    }

    const width = Math.min(86, dimensions.width - 6);
    const listWidth = Math.floor(width * 0.35);
    const diffWidth = width - listWidth - 2;

    return (
        <box flexDirection="column" width={width} height={18} gap={1}>
            {/* Header */}
            <box
                flexDirection="row"
                justifyContent="space-between"
                paddingBottom={1}
                border={['bottom']}
                borderColor={colors.dimSeparator}
            >
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    Snapshots: {snapshots.length}
                </text>
                <text fg={colors.primary}>
                    Left/Right: switch view | Up/Down: navigate | r: rollback to
                    checkpoint
                </text>
            </box>

            {/* Layout */}
            <box flexDirection="row" flexGrow={1} gap={1} width="100%">
                {/* Snapshots List */}
                <box flexDirection="column" width={listWidth} height="100%">
                    <text
                        fg={
                            columnFocus === 'list'
                                ? colors.primary
                                : colors.text
                        }
                        attributes={TextAttributes.BOLD}
                    >
                        Checkpoints
                    </text>
                    <box
                        border={['top', 'bottom', 'left', 'right']}
                        borderColor={
                            columnFocus === 'list'
                                ? colors.primary
                                : colors.dimSeparator
                        }
                        flexGrow={1}
                        padding={1}
                        flexDirection="column"
                    >
                        <scrollbox flexGrow={1}>
                            {snapshots.map((s, idx) => {
                                const isSelected = idx === selectedIndex;
                                const originalMsg = messagesList.find(
                                    (m) => m.id === s.messageId,
                                );
                                const rawText =
                                    originalMsg?.parts
                                        .filter((p: any) => p.type === 'text')
                                        .map((p: any) => p.text)
                                        .join('') || '';
                                const cleanText = rawText
                                    .replace(/\s+/g, ' ')
                                    .slice(0, 25);
                                const label =
                                    cleanText ||
                                    `Snapshot ${s.commitHash.substring(0, 6)}`;
                                const prefix =
                                    originalMsg?.role === 'assistant'
                                        ? '[AI]'
                                        : '[USER]';

                                return (
                                    <box
                                        key={s.messageId}
                                        flexDirection="row"
                                        gap={1}
                                    >
                                        <text
                                            fg={
                                                isSelected
                                                    ? colors.success
                                                    : colors.text
                                            }
                                        >
                                            {isSelected ? '▶' : ' '}
                                        </text>
                                        <text
                                            fg={
                                                isSelected
                                                    ? colors.success
                                                    : colors.text
                                            }
                                            attributes={
                                                isSelected
                                                    ? TextAttributes.BOLD
                                                    : undefined
                                            }
                                        >
                                            {prefix} {label}
                                        </text>
                                    </box>
                                );
                            })}
                        </scrollbox>
                    </box>
                </box>

                {/* Diff Viewer */}
                <box flexDirection="column" width={diffWidth} height="100%">
                    <text
                        fg={
                            columnFocus === 'diff'
                                ? colors.primary
                                : colors.text
                        }
                        attributes={TextAttributes.BOLD}
                    >
                        Details & Diff (
                        {activeSnapshot?.commitHash.substring(0, 8)})
                    </text>
                    <box
                        border={['top', 'bottom', 'left', 'right']}
                        borderColor={
                            columnFocus === 'diff'
                                ? colors.primary
                                : colors.dimSeparator
                        }
                        flexGrow={1}
                        padding={1}
                        flexDirection="column"
                    >
                        <scrollbox ref={diffScrollRef} flexGrow={1}>
                            <text fg={colors.text}>
                                {diffContent || 'No diff output.'}
                            </text>
                        </scrollbox>
                    </box>
                </box>
            </box>

            {/* Footer */}
            <box
                flexDirection="row"
                justifyContent="space-between"
                paddingTop={1}
                border={['top']}
                borderColor={colors.dimSeparator}
            >
                <text fg={colors.text} attributes={TextAttributes.DIM}>
                    r: rollback | esc: close
                </text>
            </box>
        </box>
    );
}
