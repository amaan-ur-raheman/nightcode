import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';

import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { usePromptConfig } from '@/providers/prompt-config';

import { Spinner } from '@/components/spinner';
import { InputBar } from '@/components/input-bar';
import { KeyHint } from '@/components/key-hint';
import { ToolConfirmationOverlay } from '@/components/tool-confirmation-overlay';
import { QuestionOverlay } from '@/components/question-overlay';
import type { ImageAttachment } from '@/hooks/use-chat';
import type { ConfirmationManager } from '@/lib/tools/dangerous-ops';
import type { QuestionManager } from '@/lib/tools/question-manager';

import { usePtySession } from '@/lib/pty-session';
import { useFileTree } from '@/providers/file-tree';

type SessionShellProps = {
    children?: ReactNode;
    onSubmit: (text: string) => void;
    onClear?: () => void;
    inputDisabled?: boolean;
    loading?: boolean;
    interruptible?: boolean;
    onInterrupt?: () => void;
    canRetry?: boolean;
    runningToolName?: string | null;
    messageCount?: number;
    sessionTitle?: string;
    branchIndicator?: ReactNode;
    onCreateBranch?: () => void;
    onSwitchBranch?: (branchId: string) => void;
    imageAttachments?: ImageAttachment[];
    onAddImage?: (attachment: ImageAttachment) => void;
    onRemoveImage?: (index: number) => void;
    sessionId?: string;
    confirmationManager?: ConfirmationManager;
    questionManager?: QuestionManager;
    scrollRef?: React.RefObject<any>;
    chatMode?: 'insert' | 'scroll';
    messages?: any[];
    lastLatencyMs?: number | null;
    /** Real-time token count during streaming */
    streamingTokens?: number;
    /** Timestamp when streaming started */
    streamingStartTime?: number | null;
};

export function SessionShell({
    children,
    onSubmit,
    onClear,
    inputDisabled = false,
    loading = false,
    interruptible = false,
    onInterrupt,
    canRetry = false,
    runningToolName,
    messageCount,
    sessionTitle,
    branchIndicator,
    onCreateBranch,
    onSwitchBranch,
    imageAttachments,
    onAddImage,
    onRemoveImage,
    sessionId,
    confirmationManager,
    questionManager,
    scrollRef,
    chatMode = 'insert',
    messages = [],
    lastLatencyMs,
    streamingTokens = 0,
    streamingStartTime,
}: SessionShellProps) {
    const { mode } = usePromptConfig();
    const { colors } = useTheme();
    const { active } = usePtySession();
    const { activePane } = useFileTree();
    const [hasPendingConfirmation, setHasPendingConfirmation] = useState(false);
    const [hasPendingQuestion, setHasPendingQuestion] = useState(false);

    useEffect(() => {
        if (!confirmationManager) return;
        const update = () =>
            setHasPendingConfirmation(confirmationManager.pending.size > 0);
        update();
        return confirmationManager.onChange(update);
    }, [confirmationManager]);

    useEffect(() => {
        if (!questionManager) return;
        const update = () =>
            setHasPendingQuestion(questionManager.pending.size > 0);
        update();
        return questionManager.subscribe(update);
    }, [questionManager]);

    return (
        <box
            flexDirection="column"
            flexGrow={1}
            width="100%"
            height="100%"
            paddingY={1}
            paddingX={2}
            gap={1}
        >
            <scrollbox
                ref={scrollRef}
                flexGrow={1}
                width="100%"
                stickyScroll
                stickyStart="bottom"
            >
                <box width="100%" flexDirection="column">
                    {children}
                </box>
            </scrollbox>
            <box flexShrink={0}>
                {hasPendingQuestion && questionManager ? (
                    <QuestionOverlay manager={questionManager} />
                ) : hasPendingConfirmation && confirmationManager ? (
                    <ToolConfirmationOverlay manager={confirmationManager} />
                ) : (
                    <InputBar
                        onSubmit={onSubmit}
                        disabled={inputDisabled}
                        onClear={onClear}
                        messageCount={messageCount}
                        sessionTitle={sessionTitle}
                        onCreateBranch={onCreateBranch}
                        onSwitchBranch={onSwitchBranch}
                        imageAttachments={imageAttachments}
                        onAddImage={onAddImage}
                        onRemoveImage={onRemoveImage}
                        sessionId={sessionId}
                        chatMode={chatMode}
                        messages={messages}
                        isLoading={loading}
                        onInterrupt={onInterrupt}
                        lastLatencyMs={lastLatencyMs}
                        streamingTokens={streamingTokens}
                        streamingStartTime={streamingStartTime}
                    />
                )}
            </box>
            <box
                flexShrink={0}
                flexDirection="row"
                justifyContent="space-between"
                width="100%"
                height={1}
                gap={2}
                paddingLeft={1}
            >
                <box flexDirection="row" alignItems="center" gap={2}>
                    {loading ? (
                        <>
                            <Spinner mode={mode} />
                            {runningToolName ? (
                                <text
                                    attributes={TextAttributes.DIM}
                                    fg={colors.muted}
                                >{`running ${runningToolName}... (esc/ctrl+c to interrupt)`}</text>
                            ) : interruptible ? (
                                <text
                                    attributes={TextAttributes.DIM}
                                    fg={colors.muted}
                                >
                                    esc/ctrl+c to interrupt
                                </text>
                            ) : null}
                        </>
                    ) : null}
                    {branchIndicator}
                </box>

                <box
                    flexDirection="row"
                    gap={1}
                    flexShrink={0}
                    marginLeft="auto"
                >
                    {activePane === 'chat' && (
                        <>
                            {active ? (
                                <KeyHint keyName="ctrl+p" label="terminal" />
                            ) : null}
                            {canRetry ? (
                                <KeyHint keyName="ctrl+r" label="retry" />
                            ) : null}
                            <KeyHint keyName="ctrl+b" label="branch" />
                            <KeyHint keyName="ctrl+t" label="files" />
                            <KeyHint keyName="tab" label="agents" />
                            <KeyHint keyName="ctrl+g" label="git" />
                        </>
                    )}
                    {activePane === 'file-tree' && (
                        <>
                            <KeyHint keyName="j/k" label="navigate" />
                            <KeyHint keyName="enter" label="open" />
                            <KeyHint keyName="[/]" label="resize" />
                            <KeyHint keyName="ctrl+t" label="close" />
                        </>
                    )}
                    {activePane === 'symbol-outline' && (
                        <>
                            <KeyHint keyName="j/k" label="navigate" />
                            <KeyHint keyName="l/enter" label="select" />
                            <KeyHint keyName="h" label="tree" />
                        </>
                    )}
                    {activePane === 'code-panel' && (
                        <>
                            <KeyHint keyName="j/k/h/l" label="scroll" />
                            <KeyHint keyName="ctrl+f" label="fullscreen" />
                        </>
                    )}
                    <KeyHint keyName="ctrl+w" label="pane" />
                </box>
            </box>
        </box>
    );
}
