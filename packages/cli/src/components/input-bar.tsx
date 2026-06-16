import { useNavigate } from 'react-router';
import { useRef, useCallback, useEffect, useState } from 'react';

import { Mode } from '@nightcode/shared';
import { useRenderer, useKeyboard, usePaste } from '@opentui/react';
import { decodePasteBytes } from '@opentui/core';
import {
    TextAttributes,
    type KeyBinding,
    type TextareaRenderable,
} from '@opentui/core';

import { loadSkillContent } from '@/lib/skills';
import { getModeColor } from '@/lib/mode-utils';
import { imageHandler } from '@/lib/image-handler';
import { useTheme } from '@/providers/theme';
import { useToast } from '@/providers/toast';
import { useDialog } from '@/providers/dialog';
import { usePromptConfig } from '@/providers/prompt-config';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { useFileTree } from '@/providers/file-tree';

import { EmptyBorder } from '@/components/border';
import { StatusBar } from '@/components/status-bar';
import { CommandMenu } from '@/components/command-menu';
import type { Command } from '@/components/command-menu/types';
import { useCommandMenu } from '@/components/command-menu/use-command-menu';
import { FileMentionMenu, SymbolMentionMenu } from '@/components/file-mention';
import { useFileMention } from '@/components/file-mention/use-file-mention';
import { useSymbolMention } from '@/components/file-mention/use-symbol-mention';
import { ShortcutsDialogContent } from '@/components/dialog/shortcuts-dialog';
import type { ImageAttachment } from '@/hooks/use-chat';

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
    { name: 'return', action: 'submit' },
    { name: 'enter', action: 'submit' },
    { name: 'return', shift: true, action: 'newline' },
    { name: 'enter', shift: true, action: 'newline' },
];

type InputBarProps = {
    onSubmit: (value: string) => void;
    disabled?: boolean;
    onClear?: () => void;
    messageCount?: number;
    sessionTitle?: string;
    onCreateBranch?: () => void;
    onSwitchBranch?: (branchId: string) => void;
    imageAttachments?: ImageAttachment[];
    onAddImage?: (attachment: ImageAttachment) => void;
    onRemoveImage?: (index: number) => void;
    sessionId?: string;
    chatMode?: 'insert' | 'scroll';
    messages?: any[];
    isLoading?: boolean;
    onInterrupt?: () => void;
    lastLatencyMs?: number | null;
    /** Real-time token count during streaming */
    streamingTokens?: number;
    /** Timestamp when streaming started */
    streamingStartTime?: number | null;
};

export function InputBar({
    onSubmit,
    disabled = false,
    onClear,
    messageCount,
    sessionTitle,
    onCreateBranch,
    onSwitchBranch,
    imageAttachments = [],
    onAddImage,
    onRemoveImage,
    sessionId,
    chatMode = 'insert',
    messages = [],
    isLoading = false,
    onInterrupt,
    lastLatencyMs,
    streamingTokens = 0,
    streamingStartTime,
}: InputBarProps) {
    const textareaRef = useRef<TextareaRenderable>(null);
    const onSubmitRef = useRef<() => void>(() => {});
    const [history, setHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const renderer = useRenderer();
    const toast = useToast();
    const { isTopLayer, setResponder } = useKeyboardLayer();
    const dialog = useDialog();
    const { colors } = useTheme();
    const navigate = useNavigate();
    const { mode, model, toggleMode, setModel, setMode } = usePromptConfig();
    const { toggleFileTree, openDiffMode, selectedFile, activePane } =
        useFileTree();

    const {
        showCommandMenu,
        commandQuery,
        selectedIndex: commandSelectedIndex,
        scrollRef: commandScrollRef,
        handleContentChange,
        resolveCommand,
        setSelectedIndex: setCommandSelectedIndex,
        trackRecent,
        items: commandItems,
    } = useCommandMenu(sessionId);

    const {
        showMentionMenu,
        candidates,
        selectedIndex: mentionSelectedIndex,
        scrollRef: mentionScrollRef,
        setSelectedIndex: setMentionSelectedIndex,
        sync: syncMention,
        execute: executeMention,
        handleBackspace: handleMentionBackspace,
    } = useFileMention(textareaRef);

    const {
        showSymbolMenu,
        candidates: symbolCandidates,
        selectedIndex: symbolSelectedIndex,
        scrollRef: symbolScrollRef,
        setSelectedIndex: setSymbolSelectedIndex,
        sync: syncSymbolMention,
        execute: executeSymbolMention,
        handleBackspace: handleSymbolMentionBackspace,
    } = useSymbolMention(textareaRef, selectedFile);

    const handleSubmit = useCallback(() => {
        if (disabled) return;
        const textarea = textareaRef.current;
        if (!textarea) return;
        const text = textarea.plainText.trim();
        if (text.length === 0) return;

        const skillMatch = text.match(/^\/skill:(\S+)\s*([\s\S]*)$/);
        if (skillMatch) {
            const content = loadSkillContent(skillMatch[1]!);
            if (content) {
                const userText = skillMatch[2]!.trim();
                const combined = userText
                    ? `${content}\n\n${userText}`
                    : content;
                textarea.setText('');
                onSubmit(combined);
            } else {
                toast.show({
                    message: `Skill "${skillMatch[1]}" not found`,
                    variant: 'error',
                });
            }
            return;
        }

        onSubmit(text);
        setHistory((prev) => [...prev, text]);
        setHistoryIndex(-1);
        textarea.setText('');
    }, [disabled, onSubmit]);

    const handleCommand = useCallback(
        (command: Command | undefined) => {
            const textarea = textareaRef.current;
            if (!command || !textarea) return;
            trackRecent(command.value).catch(() => {});
            textarea.setText('');
            if (command.action) {
                command.action({
                    exit: () => renderer.destroy(),
                    toast,
                    dialog,
                    navigate,
                    mode,
                    model,
                    setMode,
                    setModel,
                    setInputValue: (value: string) => {
                        textarea.setText(value);
                        textarea.cursorOffset = value.length;
                    },
                    clearMessages: () => {
                        onClear?.();
                    },
                    createBranch: () => {
                        onCreateBranch?.();
                    },
                    switchBranch: (branchId: string) => {
                        onSwitchBranch?.(branchId);
                    },
                    toggleFileTree,
                    openDiffMode,
                    sessionId,
                });
            } else {
                textarea.insertText(command.value + ' ');
            }
        },
        [
            renderer,
            toast,
            dialog,
            navigate,
            mode,
            model,
            setMode,
            setModel,
            onClear,
            onCreateBranch,
            onSwitchBranch,
            toggleFileTree,
            openDiffMode,
            sessionId,
            trackRecent,
        ],
    );

    const handleCommandExecute = useCallback(
        (index: number) => {
            handleCommand(resolveCommand(index));
        },
        [resolveCommand, handleCommand],
    );

    const handleTextareaContentChange = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        handleContentChange(textarea.plainText);
        if (selectedFile) {
            syncSymbolMention(textarea.plainText, textarea.cursorOffset);
        } else {
            syncMention(textarea.plainText, textarea.cursorOffset);
        }
    }, [handleContentChange, syncMention, syncSymbolMention, selectedFile]);

    const handleTextareaCursorChange = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        if (selectedFile) {
            syncSymbolMention(textarea.plainText, textarea.cursorOffset);
        } else {
            syncMention(textarea.plainText, textarea.cursorOffset);
        }
    }, [syncMention, syncSymbolMention, selectedFile]);

    // Wire up the textarea submit handler once so it always reads the latest state
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.onSubmit = () => {
            onSubmitRef.current();
        };
    }, []);

    onSubmitRef.current = () => {
        if (disabled) return;

        if (showCommandMenu) {
            handleCommand(resolveCommand(commandSelectedIndex));
            return;
        }

        if (showMentionMenu) {
            const candidate = candidates[mentionSelectedIndex];
            if (candidate) {
                executeMention(mentionSelectedIndex);
            }
            return;
        }

        if (showSymbolMenu) {
            const candidate = symbolCandidates[symbolSelectedIndex];
            if (candidate) {
                executeSymbolMention(symbolSelectedIndex);
            }
            return;
        }

        handleSubmit();
    };

    const handleAttachImage = useCallback(async () => {
        const textarea = textareaRef.current;
        if (!textarea || !onAddImage) return;

        // Prompt for file path using a simple approach: user types the path in the textarea
        // We'll intercept the current text as a file path
        let filePath = textarea.plainText.trim();
        if (!filePath) {
            toast.show({
                message: 'Type an image file path, then press Ctrl+A to attach',
                variant: 'info',
            });
            return;
        }

        // Clean up quotes from dragging/dropping files
        if (
            (filePath.startsWith("'") && filePath.endsWith("'")) ||
            (filePath.startsWith('"') && filePath.endsWith('"'))
        ) {
            filePath = filePath.slice(1, -1);
        }

        if (!imageHandler.isSupportedImage(filePath)) {
            toast.show({
                message:
                    'Unsupported image format. Use PNG, JPEG, GIF, WebP, SVG, or BMP.',
                variant: 'error',
            });
            return;
        }

        try {
            const { dataUrl, mimeType } =
                await imageHandler.fileToDataUrl(filePath);
            if (!imageHandler.validateSize(dataUrl)) {
                toast.show({
                    message: 'Image too large. Maximum size is 10MB.',
                    variant: 'error',
                });
                return;
            }
            onAddImage({
                dataUrl,
                mimeType,
                name: imageHandler.getDisplayName(filePath),
            });
            textarea.setText('');
            toast.show({
                message: `Attached: ${imageHandler.getDisplayName(filePath)}`,
                variant: 'success',
            });
        } catch (err) {
            toast.show({
                message:
                    err instanceof Error
                        ? err.message
                        : 'Failed to read image file',
                variant: 'error',
            });
        }
    }, [onAddImage, toast]);

    useKeyboard((key) => {
        if (disabled) return;
        if (
            !isTopLayer('base') &&
            !isTopLayer('command') &&
            !isTopLayer('mention') &&
            !isTopLayer('symbol-mention')
        )
            return;

        if (key.name === 'tab') {
            key.preventDefault();
            toggleMode();
        }

        if (key.ctrl && (key.name === 'a' || key.name === 'i')) {
            key.preventDefault();
            handleAttachImage();
            return;
        }

        if (key.ctrl && key.name === 'p') {
            key.preventDefault();
            const textarea = textareaRef.current;
            if (textarea && textarea.plainText.trim().length === 0) {
                textarea.setText('/');
            }
            return;
        }

        if (key.name === 'slash' && !key.ctrl) {
            // Don't intercept if typing in textarea
        }

        const isCtrlQuestionOrSlash =
            (key.ctrl &&
                (key.name === 'slash' ||
                    key.name === '/' ||
                    key.name === '?' ||
                    key.name === '_')) ||
            key.sequence === '\x1f' ||
            key.sequence === '\u001f' ||
            key.raw === '\u001f' ||
            key.raw === '\u001b[47;9u' ||
            key.raw === '\u001b[47;5u';

        if (isCtrlQuestionOrSlash) {
            key.preventDefault();
            dialog.open({
                title: 'Keyboard Shortcuts',
                children: <ShortcutsDialogContent />,
            });
            return;
        }

        if (key.name === 't' && key.ctrl && sessionId) {
            key.preventDefault();
            toggleFileTree();
            return;
        }

        if (key.name === 'backspace' && !showMentionMenu && !showSymbolMenu) {
            const textarea = textareaRef.current;
            if (textarea && textarea.plainText.length === 0) {
                if (imageAttachments.length > 0 && onRemoveImage) {
                    key.preventDefault();
                    onRemoveImage(imageAttachments.length - 1);
                    return;
                }
            }
            if (handleMentionBackspace() || handleSymbolMentionBackspace()) {
                key.preventDefault();
            }
        }

        // Ctrl+E - move cursor to end of line
        if (key.ctrl && key.name === 'e') {
            key.preventDefault();
            const textarea = textareaRef.current;
            if (textarea) {
                textarea.cursorOffset = textarea.plainText.length;
            }
            return;
        }

        // Ctrl+W - delete word before cursor
        if (key.ctrl && key.name === 'w') {
            key.preventDefault();
            const textarea = textareaRef.current;
            if (textarea && textarea.plainText.length > 0) {
                const text = textarea.plainText;
                const cursorPos = textarea.cursorOffset;
                const beforeCursor = text.slice(0, cursorPos);
                const afterCursor = text.slice(cursorPos);
                const lastSpace = beforeCursor.lastIndexOf(' ');
                const newBefore =
                    lastSpace >= 0 ? beforeCursor.slice(0, lastSpace) : '';
                textarea.setText(newBefore + afterCursor);
                textarea.cursorOffset = newBefore.length;
            }
            return;
        }

        // Ctrl+U - delete entire line
        if (key.ctrl && key.name === 'u') {
            key.preventDefault();
            const textarea = textareaRef.current;
            if (textarea) {
                textarea.setText('');
            }
            return;
        }

        // Up/Down arrows - history navigation
        if (
            key.name === 'up' &&
            !showCommandMenu &&
            !showMentionMenu &&
            !showSymbolMenu
        ) {
            key.preventDefault();
            const textarea = textareaRef.current;
            if (textarea && history.length > 0) {
                const newIndex =
                    historyIndex < history.length - 1
                        ? historyIndex + 1
                        : historyIndex;
                setHistoryIndex(newIndex);
                textarea.setText(history[history.length - 1 - newIndex] ?? '');
            }
            return;
        }

        if (
            key.name === 'down' &&
            !showCommandMenu &&
            !showMentionMenu &&
            !showSymbolMenu
        ) {
            key.preventDefault();
            const textarea = textareaRef.current;
            if (textarea && history.length > 0) {
                const newIndex = historyIndex > 0 ? historyIndex - 1 : -1;
                setHistoryIndex(newIndex);
                textarea.setText(
                    newIndex >= 0
                        ? (history[history.length - 1 - newIndex] ?? '')
                        : '',
                );
            }
            return;
        }
    });

    // Auto-attach image files when pasted as file paths
    usePaste((event) => {
        if (disabled || !onAddImage) return;

        const text = decodePasteBytes(event.bytes).trim();
        if (!text || !imageHandler.isImagePath(text)) return;

        event.preventDefault();

        (async () => {
            let filePath = text;

            // Clean up quotes from dragging/dropping files
            if (
                (filePath.startsWith("'") && filePath.endsWith("'")) ||
                (filePath.startsWith('"') && filePath.endsWith('"'))
            ) {
                filePath = filePath.slice(1, -1);
            }

            if (!imageHandler.isSupportedImage(filePath)) {
                toast.show({
                    message:
                        'Unsupported image format. Use PNG, JPEG, GIF, WebP, SVG, or BMP.',
                    variant: 'error',
                });
                return;
            }

            try {
                const { dataUrl, mimeType } =
                    await imageHandler.fileToDataUrl(filePath);
                if (!imageHandler.validateSize(dataUrl)) {
                    toast.show({
                        message: 'Image too large. Maximum size is 10MB.',
                        variant: 'error',
                    });
                    return;
                }
                onAddImage({
                    dataUrl,
                    mimeType,
                    name: imageHandler.getDisplayName(filePath),
                });
                toast.show({
                    message: `Attached: ${imageHandler.getDisplayName(filePath)}`,
                    variant: 'success',
                });
            } catch (err) {
                toast.show({
                    message:
                        err instanceof Error
                            ? err.message
                            : 'Failed to read image file',
                    variant: 'error',
                });
            }
        })();
    });

    useEffect(() => {
        setResponder('base', () => {
            if (isLoading && onInterrupt) {
                onInterrupt();
                return true;
            }
            if (disabled) return false;
            const textarea = textareaRef.current;
            if (textarea && textarea.plainText.length > 0) {
                textarea.setText('');
                return true;
            }
            return false;
        });
        return () => setResponder('base', null);
    }, [disabled, isLoading, onInterrupt, setResponder]);

    return (
        <box width="100%" alignItems="center">
            <box
                width="100%"
                border={['left']}
                borderColor={
                    activePane === 'chat'
                        ? getModeColor(mode, colors)
                        : colors.dimSeparator
                }
                customBorderChars={{
                    ...EmptyBorder,
                    vertical: '┃',
                    bottomLeft: '╹',
                }}
            >
                <box
                    position="relative"
                    justifyContent="center"
                    paddingX={2}
                    paddingY={1}
                    backgroundColor={colors.surface}
                    width="100%"
                    gap={1}
                >
                    {showCommandMenu && (
                        <box
                            position="absolute"
                            bottom="100%"
                            left={0}
                            width="100%"
                            backgroundColor={colors.surface}
                            zIndex={10}
                        >
                            <CommandMenu
                                query={commandQuery}
                                selectedIndex={commandSelectedIndex}
                                scrollRef={commandScrollRef}
                                onSelect={setCommandSelectedIndex}
                                onExecute={handleCommandExecute}
                                items={commandItems}
                            />
                        </box>
                    )}
                    {!showCommandMenu && showMentionMenu && (
                        <box
                            position="absolute"
                            bottom="100%"
                            left={0}
                            width="100%"
                            backgroundColor={colors.surface}
                            zIndex={10}
                        >
                            <FileMentionMenu
                                candidates={candidates}
                                selectedIndex={mentionSelectedIndex}
                                scrollRef={mentionScrollRef}
                                onSelect={setMentionSelectedIndex}
                                onExecute={executeMention}
                            />
                        </box>
                    )}
                    {!showCommandMenu && !showMentionMenu && showSymbolMenu && (
                        <box
                            position="absolute"
                            bottom="100%"
                            left={0}
                            width="100%"
                            backgroundColor={colors.surface}
                            zIndex={10}
                        >
                            <SymbolMentionMenu
                                candidates={symbolCandidates}
                                selectedIndex={symbolSelectedIndex}
                                scrollRef={symbolScrollRef}
                                onSelect={setSymbolSelectedIndex}
                                onExecute={executeSymbolMention}
                            />
                        </box>
                    )}
                    <box flexDirection="row" alignItems="center" gap={1}>
                        {imageAttachments.length > 0 && (
                            <box flexDirection="row" gap={1} flexShrink={0}>
                                {imageAttachments.map((img, i) => {
                                    const ext =
                                        img.name
                                            .split('.')
                                            .pop()
                                            ?.toUpperCase() ?? 'IMG';
                                    const maxNameLen = 20;
                                    const displayName =
                                        img.name.length > maxNameLen
                                            ? img.name.slice(0, maxNameLen) +
                                              '…'
                                            : img.name;
                                    return (
                                        <box
                                            key={`img-${img.name}-${i}`}
                                            flexDirection="row"
                                            alignItems="center"
                                            gap={0}
                                        >
                                            <box
                                                backgroundColor={
                                                    colors.planMode
                                                }
                                                paddingLeft={1}
                                                paddingRight={1}
                                            >
                                                <text
                                                    fg="black"
                                                    attributes={
                                                        TextAttributes.BOLD
                                                    }
                                                >
                                                    {ext}
                                                </text>
                                            </box>
                                            <text> {displayName}</text>
                                            {onRemoveImage && (
                                                <text
                                                    {...({
                                                        onClick: () =>
                                                            onRemoveImage(i),
                                                        fg: colors.dimSeparator,
                                                    } as any)}
                                                >
                                                    {' ×'}
                                                </text>
                                            )}
                                        </box>
                                    );
                                })}
                            </box>
                        )}
                        <textarea
                            flexGrow={1}
                            ref={textareaRef}
                            focused={
                                !disabled &&
                                activePane === 'chat' &&
                                chatMode === 'insert' &&
                                (isTopLayer('base') ||
                                    isTopLayer('command') ||
                                    isTopLayer('mention'))
                            }
                            keyBindings={TEXTAREA_KEY_BINDINGS}
                            onContentChange={handleTextareaContentChange}
                            onCursorChange={handleTextareaCursorChange}
                            placeholder={
                                chatMode === 'scroll'
                                    ? 'SCROLL MODE — Press i to type, j/k to scroll'
                                    : mode === Mode.PLAN
                                      ? 'Describe what to plan... (@ for files)'
                                      : 'Describe what to build... (@ for files)'
                            }
                        />
                    </box>
                    <StatusBar
                        messageCount={messageCount}
                        sessionTitle={sessionTitle}
                        messages={messages}
                        isLoading={isLoading}
                        lastLatencyMs={lastLatencyMs}
                        streamingTokens={streamingTokens}
                        streamingStartTime={streamingStartTime}
                    />
                </box>
            </box>
        </box>
    );
}
