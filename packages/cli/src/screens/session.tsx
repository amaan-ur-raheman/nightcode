import { z } from 'zod';
import type { InferResponseType } from 'hono/client';
import React from 'react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { useDialog } from '@/providers/dialog';

import { SessionShell } from '@/components/session-shell';
import { FileTree } from '@/components/file-tree';
import {
    CommitDialogContent,
    GraphViewer,
    TimelineDialogContent,
} from '@/components/dialog';
import { timelineManager } from '@/lib/timeline-manager';
import { FileDiffPanel } from '@/components/file-diff-panel';
import { BranchIndicator } from '@/components/branch-indicator';
import { UserMessage, ErrorMessage, BotMessage } from '@/components/messages';
import { QuestionOverlay } from '@/components/question-overlay';
import { SymbolOutline } from '@/components/symbol-outline';
import { CodePanel } from '@/components/code-panel';
import { MessageSearch } from '@/components/message-search';

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
    const { colors } = useTheme();

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

    if (msg.role === 'system') {
        const text = msg.parts
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('');

        return (
            <box
                paddingLeft={4}
                paddingRight={2}
                paddingY={1}
                width="100%"
                flexDirection="column"
                marginBottom={1}
            >
                <box
                    border={['left']}
                    borderColor={colors.thinkingBorder}
                    paddingLeft={2}
                    width="100%"
                >
                    <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
                        {text}
                    </text>
                </box>
            </box>
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
import { fileWatcher } from '@/lib/file-watcher';

import { usePtySession } from '@/lib/pty-session';

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
    const dialog = useDialog();
    const pty = usePtySession();
    const toast = useToast();
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
        streamingTokens,
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

    // Start file watcher when session loads
    useEffect(() => {
        if (!fileWatcher.isWatching()) {
            fileWatcher.start();
        }
        return () => {
            // Don't stop watcher on unmount — it's shared across sessions
        };
    }, []);

    // Let the user cancel a reply even before the first streamed chunks arrived
    const keyHandlerRef = useRef<((key: any) => void) | undefined>(undefined);
    keyHandlerRef.current = (key) => {
        // If loading (tool is executing), Escape should interrupt/stop it immediately
        if (key.name === 'escape' && isTopLayer('base') && isLoading) {
            key.preventDefault();
            interrupt();
            return;
        }

        // Handle chat mode switching & scrolling
        if (activePane === 'chat') {
            if (chatMode === 'insert') {
                if (key.name === 'escape' && isTopLayer('base')) {
                    key.preventDefault();
                    setChatMode('scroll');
                    return;
                }
            } else if (chatMode === 'scroll') {
                if (
                    key.name === 'i' ||
                    key.name === 'a' ||
                    key.name === 'return' ||
                    key.name === 'enter'
                ) {
                    key.preventDefault();
                    setChatMode('insert');
                    return;
                }
                if (key.name === 'j' || key.name === 'down') {
                    key.preventDefault();
                    const sb = chatScrollRef.current;
                    if (sb) {
                        sb.scrollTo(sb.scrollTop + 1);
                    }
                    return;
                }
                if (key.name === 'k' || key.name === 'up') {
                    key.preventDefault();
                    const sb = chatScrollRef.current;
                    if (sb) {
                        sb.scrollTo(Math.max(0, sb.scrollTop - 1));
                    }
                    return;
                }
            }
        }

        // Pane navigation via Ctrl+W cycles focus between Chat input, File tree, Outline, and Code panel.
        if (key.name === 'w' && key.ctrl && isTopLayer('base')) {
            key.preventDefault();
            const availablePanes: (
                | 'file-tree'
                | 'symbol-outline'
                | 'code-panel'
                | 'chat'
            )[] = [];
            if (showFileTree && !isFullscreenCode) {
                availablePanes.push('file-tree');
            }
            if (selectedFile) {
                if (!isFullscreenCode) {
                    availablePanes.push('symbol-outline');
                }
                availablePanes.push('code-panel');
            }
            if (!isFullscreenCode) {
                availablePanes.push('chat');
            }
            if (availablePanes.length > 0) {
                const currentIdx = availablePanes.indexOf(activePane);
                const nextIdx = (currentIdx + 1) % availablePanes.length;
                const nextPane = availablePanes[nextIdx] ?? 'chat';
                setActivePane(nextPane);
            }
        }

        // Fullscreen code panel toggle via Ctrl+F.
        if (key.name === 'f' && key.ctrl && isTopLayer('base')) {
            key.preventDefault();
            if (selectedFile) {
                setIsFullscreenCode((prev) => {
                    const next = !prev;
                    if (next) {
                        setActivePane('code-panel');
                    } else {
                        setActivePane('chat');
                    }
                    return next;
                });
            }
        }

        // Message search via Ctrl+H
        if (key.name === 'h' && key.ctrl && isTopLayer('base')) {
            key.preventDefault();
            setIsSearchOpen((prev) => !prev);
        }

        if (key.name === 'escape' && isTopLayer('base') && isLoading) {
            key.preventDefault();
            interrupt();
        }
        if (key.name === 'r' && key.ctrl && isTopLayer('base') && !isLoading) {
            key.preventDefault();
            requestStartTimeRef.current = Date.now();
            retryLast();
        }
        if (key.name === 'b' && key.ctrl && isTopLayer('base') && !isLoading) {
            key.preventDefault();
            createBranch();
        }
        if (key.name === 'g' && key.ctrl && isTopLayer('base') && !isLoading) {
            key.preventDefault();
            dialog.open({
                title: 'Git Commit Planner',
                children: (
                    <CommitDialogContent sessionId={session.id} model={model} />
                ),
            });
        }
        if (key.name === 'k' && key.ctrl && isTopLayer('base') && !isLoading) {
            key.preventDefault();
            dialog.open({
                title: 'Workspace Knowledge Graph',
                width: 94,
                children: (
                    <GraphViewer
                        onClose={dialog.close}
                        onSelectFile={(filePath, line) => {
                            setSelectedFile(filePath);
                            if (line !== undefined) {
                                setHighlightedLine(line);
                            }
                            dialog.close();
                        }}
                    />
                ),
            });
        }
        if (key.name === 'p' && key.ctrl && isTopLayer('base') && pty.active) {
            key.preventDefault();
            pty.attach();
        }
        if (key.name === 'h' && key.ctrl && isTopLayer('base') && !isLoading) {
            key.preventDefault();
            dialog.open({
                title: 'Session Playback Timeline',
                width: 94,
                children: (
                    <TimelineDialogContent
                        sessionId={session.id}
                        messages={messages}
                        onRollback={async (commitHash) => {
                            const timeline = await timelineManager.loadTimeline(
                                session.id,
                            );
                            const snapshot = Object.values(
                                timeline.snapshots,
                            ).find((s) => s.commitHash === commitHash);
                            if (snapshot) {
                                const branch = branches.find(
                                    (b) => b.id === snapshot.messageId,
                                );
                                if (branch) {
                                    await switchBranch(branch.id);
                                }
                            }
                            dialog.close();
                            toast.show({
                                message:
                                    'Workspace rolled back successfully to checkpoint.',
                                variant: 'success',
                            });
                        }}
                    />
                ),
            });
        }
    };

    useKeyboard((key) => {
        keyHandlerRef.current?.(key);
    });

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
        requestStartTimeRef.current = Date.now();
        void submit({
            userText: initialPrompt.message,
            mode: initialPrompt.mode,
            model: initialPrompt.model,
        });
    }, [initialPrompt, submit]);

    const {
        showFileTree,
        selectedFile,
        setSelectedFile,
        diffMode,
        activePane,
        setActivePane,
    } = useFileTree();
    const [highlightedLine, setHighlightedLine] = useState<
        number | undefined
    >();
    const [isFullscreenCode, setIsFullscreenCode] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const handleCloseSearch = useCallback(() => {
        setIsSearchOpen(false);
    }, []);
    const handleJumpToMessage = useCallback(
        (idx: number) => {
            const sb = chatScrollRef.current;
            if (!sb) return;

            // Convert full-message index to position within visibleMessages
            const offset = messages.length - visibleMessages.length;
            const visibleIdx = idx - offset;

            if (visibleIdx >= 0 && visibleIdx < visibleMessages.length) {
                sb.scrollTo(visibleIdx);
            } else {
                // Message is outside the visible window; scroll to top as fallback
                sb.scrollTo(0);
            }
        },
        [messages.length, visibleMessages.length],
    );
    const [chatMode, setChatMode] = useState<'insert' | 'scroll'>('insert');
    const chatScrollRef = useRef<any>(null);

    const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
    const requestStartTimeRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isLoading) {
            if (requestStartTimeRef.current) {
                const duration = Date.now() - requestStartTimeRef.current;
                setLastLatencyMs(duration);
                requestStartTimeRef.current = null;
            }
        }
    }, [isLoading]);

    useEffect(() => {
        if (activePane !== 'chat') {
            setChatMode('insert');
        }
    }, [activePane]);

    useEffect(() => {
        setHighlightedLine(undefined);
    }, [selectedFile]);

    useEffect(() => {
        if (!selectedFile) {
            setIsFullscreenCode(false);
        }
    }, [selectedFile]);

    const renderChat = !isFullscreenCode;
    const renderFileTree = showFileTree && !isFullscreenCode;
    const renderCodeViewer = !!selectedFile;

    return (
        <box flexDirection="row" width="100%" height="100%">
            {renderFileTree && (
                <FileTree
                    rootPath={process.cwd()}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                />
            )}

            {renderCodeViewer && (
                <box
                    flexDirection="row"
                    flexGrow={60}
                    width={isFullscreenCode ? '100%' : '60%'}
                    height="100%"
                >
                    {diffMode ? (
                        <FileDiffPanel filePath={selectedFile} />
                    ) : (
                        <box flexDirection="row" flexGrow={1} height="100%">
                            {!isFullscreenCode && (
                                <SymbolOutline
                                    filePath={selectedFile}
                                    onSelectSymbol={(sym) =>
                                        setHighlightedLine(sym.line)
                                    }
                                />
                            )}
                            <CodePanel
                                filePath={selectedFile}
                                highlightedLine={highlightedLine}
                            />
                        </box>
                    )}
                </box>
            )}

            {renderChat && (
                <box
                    flexDirection="column"
                    flexGrow={renderCodeViewer ? 40 : 1}
                    width={renderCodeViewer ? '40%' : '100%'}
                    height="100%"
                >
                    <SessionShell
                        onSubmit={(text) => {
                            requestStartTimeRef.current = Date.now();
                            submit({ userText: text, mode, model });
                        }}
                        onClear={clearMessages}
                        loading={isLoading}
                        interruptible={isLoading}
                        onInterrupt={interrupt}
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
                        scrollRef={chatScrollRef}
                        chatMode={chatMode}
                        messages={messages}
                        lastLatencyMs={lastLatencyMs}
                        streamingTokens={streamingTokens}
                        streamingStartTime={requestStartTimeRef.current}
                    >
                        <MessageSearch
                            messages={messages}
                            isOpen={isSearchOpen}
                            onClose={handleCloseSearch}
                            onJumpToMessage={handleJumpToMessage}
                        />
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
                                onRetry={retryLast}
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
