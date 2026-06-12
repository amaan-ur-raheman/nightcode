import { z } from 'zod';
import type { InferResponseType } from 'hono/client';
import React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';

import { useKeyboard, useSelectionHandler } from '@opentui/react';
import { TextAttributes } from '@opentui/core';
import { type ModeType, type SupportedChatModelId } from '@nightcode/shared';

import { useChat } from '@/hooks/use-chat';
import { apiClient } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/http-errors';
import type { Message, ImageAttachment } from '@/hooks/use-chat';

import { useToast } from '@/providers/toast';
import { usePromptConfig } from '@/providers/prompt-config';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { useCoalescedMessages } from '@/hooks/use-coalesced-messages';
import { useTheme } from '@/providers/theme';
import { orchestratorManager } from '@/lib/orchestrator-manager';
import { useFileTree } from '@/providers/file-tree';

import { SessionShell } from '@/components/session-shell';
import { FileTree } from '@/components/file-tree';
import { FileDiffPanel } from '@/components/file-diff-panel';
import { BranchIndicator } from '@/components/branch-indicator';
import { UserMessage, ErrorMessage, BotMessage } from '@/components/messages';
import { QuestionOverlay } from '@/components/question-overlay';

type SessionData = InferResponseType<
    (typeof apiClient.sessions)[':id']['$get'],
    200
>;

const sessionLocationSchema = z.object({
    session: z.custom<SessionData>(
        (val) => val !== null && typeof val === 'object' && 'id' in val,
    ),
    initialPrompt: z
        .object({
            message: z.string(),
            mode: z.custom<ModeType>(),
            model: z.custom<SupportedChatModelId>(),
            imageAttachments: z
                .array(
                    z.object({
                        dataUrl: z.string(),
                        mimeType: z.string(),
                        name: z.string(),
                    }),
                )
                .optional(),
        })
        .optional(),
});

function ChatMessage({
    msg,
    streaming = false,
}: {
    msg: Message;
    streaming?: boolean;
}) {
    if (msg.role === 'user') {
        const text = msg.parts
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('');

        const imageAttachments = msg.parts
            .filter((p) => (p.type as string) === 'file')
            .map((p) => ({
                name: (p as any).filename ?? 'unknown',
                kind: ((p as any).mediaType?.startsWith('image/')
                    ? 'image'
                    : 'file') as 'image' | 'file',
            }));

        return (
            <UserMessage
                message={text}
                mode={msg.metadata?.mode ?? 'BUILD'}
                imageCount={imageAttachments.length}
            />
        );
    }

    return (
        <BotMessage
            parts={msg.parts}
            mode={msg.metadata?.mode ?? 'BUILD'}
            model={msg.metadata?.model ?? 'Unknown'}
            durationMs={msg.metadata?.durationMs}
            streaming={streaming}
        />
    );
}

const MemoizedChatMessage = React.memo(ChatMessage);

const MAX_VISIBLE_MESSAGES = 200;

import { lastSession, writeLastSession } from '@/index';

function SessionChat({
    session,
    initialPrompt,
}: {
    session: SessionData;
    initialPrompt?: {
        message: string;
        mode: ModeType;
        model: string;
        imageAttachments?: ImageAttachment[];
    };
}) {
    const [initialMessages] = useState(
        session.messages as unknown as Message[],
    );
    const { mode, model } = usePromptConfig();
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const {
        messages,
        submit,
        abort,
        status,
        interrupt,
        error,
        isLoading,
        clearMessages,
        retryLast,
        runningToolName,
        branches,
        activeBranchId,
        createBranch,
        switchBranch,
        confirmationManager,
        questionManager,
        imageAttachments,
        addImageAttachment,
        removeImageAttachment,
    } = useChat(session.id, initialMessages, initialPrompt?.imageAttachments);
    const hasSubmittedInitialPromptRef = useRef(false);

    // Coalesce streaming updates to ~15fps for smoother rendering
    const displayMessages = useCoalescedMessages(
        messages,
        status === 'streaming',
    );
    const visibleMessages = displayMessages.slice(-MAX_VISIBLE_MESSAGES);

    useEffect(() => {
        lastSession.id = session.id;
        lastSession.title = session.title;
        writeLastSession({ id: session.id, title: session.title ?? '' });
    }, [session.id, session.title]);

    // Stop any pending replies when the user leaves this session
    useEffect(() => {
        return () => {
            void abort();
        };
    }, [abort]);

    // Let the user cancel a reply even before the first streamed chunks arrived
    useKeyboard((key) => {
        if (key.name === 'escape' && isTopLayer('base') && isLoading) {
            key.preventDefault();
            interrupt();
        }
        if (key.name === 'r' && key.ctrl && isTopLayer('base') && !isLoading) {
            key.preventDefault();
            retryLast();
        }
        if (key.name === 'b' && key.ctrl && isTopLayer('base') && !isLoading) {
            key.preventDefault();
            createBranch();
        }
    });

    const toast = useToast();

    useSelectionHandler((selection) => {
        const text = selection.getSelectedText();
        if (!text) return;

        (async () => {
            try {
                if (
                    typeof navigator !== 'undefined' &&
                    (navigator as any).clipboard?.writeText
                ) {
                    try {
                        await (navigator as any).clipboard.writeText(text);
                        toast.show({
                            variant: 'success',
                            message: `Copied ${text.length} chars`,
                        });
                        return;
                    } catch {
                        // Fallback to command line if navigator.clipboard fails
                    }
                }

                const platform = process.platform;
                let commands: string[][];
                if (platform === 'darwin') {
                    commands = [['pbcopy']];
                } else if (platform === 'win32') {
                    commands = [['clip']];
                } else if (platform === 'linux') {
                    commands = [
                        ['xclip', '-selection', 'clipboard'],
                        ['wl-copy'],
                    ];
                } else {
                    commands = [
                        ['xclip', '-selection', 'clipboard'],
                        ['wl-copy'],
                        ['pbcopy'],
                        ['clip'],
                    ];
                }

                let lastError: unknown = null;
                for (const cmd of commands) {
                    try {
                        const proc = Bun.spawn(cmd, { stdin: 'pipe' });
                        proc.stdin.write(text);
                        await proc.stdin.end();
                        const exitCode = await proc.exited;
                        if (exitCode === 0) {
                            toast.show({
                                variant: 'success',
                                message: `Copied ${text.length} chars`,
                            });
                            return;
                        }
                        lastError = new Error(
                            `${cmd[0]} exited with code ${exitCode}`,
                        );
                    } catch (err) {
                        lastError = err;
                    }
                }

                toast.show({
                    variant: 'error',
                    message:
                        lastError instanceof Error
                            ? lastError.message
                            : 'Failed to copy selection to clipboard',
                });
            } catch (err) {
                toast.show({
                    variant: 'error',
                    message:
                        err instanceof Error
                            ? err.message
                            : 'Failed to copy selection to clipboard',
                });
            }
        })();
    });

    useEffect(() => {
        if (!initialPrompt || hasSubmittedInitialPromptRef.current) return;

        hasSubmittedInitialPromptRef.current = true;
        void submit({
            userText: initialPrompt.message,
            mode: initialPrompt.mode,
            model: initialPrompt.model,
        });
    }, [initialPrompt, submit]);

    const { showFileTree, selectedFile, setSelectedFile } = useFileTree();

    return (
        <box flexDirection="row" width="100%" height="100%">
            {showFileTree && (
                <FileTree
                    rootPath={process.cwd()}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                />
            )}
            {showFileTree && selectedFile ? (
                <FileDiffPanel filePath={selectedFile} />
            ) : (
                <box flexDirection="column" flexGrow={1}>
                    <SessionShell
                        onSubmit={(text) =>
                            submit({ userText: text, mode, model })
                        }
                        onClear={clearMessages}
                        loading={isLoading}
                        interruptible={isLoading}
                        canRetry={
                            !isLoading &&
                            messages.some((m) => m.role === 'user')
                        }
                        runningToolName={runningToolName}
                        messageCount={
                            messages.filter((m) => m.role === 'user').length
                        }
                        sessionTitle={session.title}
                        branchIndicator={
                            <BranchIndicator
                                branches={branches}
                                activeBranchId={activeBranchId}
                                onCreateBranch={() => createBranch()}
                            />
                        }
                        onCreateBranch={() => createBranch()}
                        onSwitchBranch={switchBranch}
                        imageAttachments={imageAttachments}
                        onAddImage={addImageAttachment}
                        onRemoveImage={removeImageAttachment}
                        sessionId={session.id}
                        confirmationManager={confirmationManager}
                        questionManager={questionManager}
                    >
                        {displayMessages.length > MAX_VISIBLE_MESSAGES && (
                            <box paddingX={3} paddingTop={1}>
                                <text
                                    attributes={TextAttributes.DIM}
                                    fg={colors.dimSeparator}
                                >
                                    {`… ${displayMessages.length - MAX_VISIBLE_MESSAGES} earlier messages hidden`}
                                </text>
                            </box>
                        )}
                        {visibleMessages.map((msg, i) => (
                            <ChatMessage
                                key={msg.id}
                                msg={msg}
                                streaming={
                                    status === 'streaming' &&
                                    i === visibleMessages.length - 1
                                }
                            />
                        ))}
                        {error && (
                            <ErrorMessage
                                message={error.message}
                                canRetry={!isLoading}
                            />
                        )}
                    </SessionShell>
                </box>
            )}
        </box>
    );
}

export function Session() {
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const toast = useToast();

    const prefetched = useMemo(() => {
        const parsed = sessionLocationSchema.safeParse(location.state);
        return parsed.success ? parsed.data : null;
    }, [location.state]);

    const [session, setSession] = useState<SessionData | null>(
        prefetched?.session ?? null,
    );

    useEffect(() => {
        // Skip fetch if session was passed via location state
        if (prefetched?.session) return;

        setSession(null);

        if (!id) return;

        let ignore = false;
        const fetchSession = async () => {
            try {
                const res = await apiClient.sessions[':id'].$get({
                    param: { id },
                });

                if (ignore) return;
                if (!res.ok) throw new Error(await getErrorMessage(res));

                const resolved = await res.json();
                setSession(resolved);
            } catch (err) {
                if (ignore) return;
                // Don't redirect to home if orchestration is running — workers need the session
                const hasActiveOrchestrations =
                    orchestratorManager.getAll().length > 0;
                if (hasActiveOrchestrations) {
                    toast.show({
                        variant: 'error',
                        message:
                            err instanceof Error
                                ? err.message
                                : 'Failed to load session (orchestration active)',
                    });
                    return;
                }
                toast.show({
                    variant: 'error',
                    message:
                        err instanceof Error
                            ? err.message
                            : 'Failed to load session',
                });
                navigate('/', { replace: true });
            }
        };

        fetchSession();
        return () => {
            ignore = true;
        };
    }, [id, prefetched, toast, navigate]);

    if (!session) {
        return <SessionShell onSubmit={() => {}} inputDisabled loading />;
    }

    return (
        <SessionChat
            key={session.id}
            session={session}
            initialPrompt={prefetched?.initialPrompt}
        />
    );
}
