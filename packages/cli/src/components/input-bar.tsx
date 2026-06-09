import { useNavigate } from "react-router";
import { useRef, useCallback, useEffect } from "react";

import { Mode } from "@nightcode/shared";
import { useRenderer, useKeyboard } from "@opentui/react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";

import { loadSkillContent } from "@/lib/skills";
import { getModeColor } from "@/lib/mode-utils";
import { useTheme } from "@/providers/theme";
import { useToast } from "@/providers/toast";
import { useDialog } from "@/providers/dialog";
import { usePromptConfig } from "@/providers/prompt-config";
import { useKeyboardLayer } from "@/providers/keyboard-layer";

import { EmptyBorder } from "@/components/border";
import { StatusBar } from "@/components/status-bar";
import { CommandMenu } from "@/components/command-menu";
import type { Command } from "@/components/command-menu/types";
import { useCommandMenu } from "@/components/command-menu/use-command-menu";
import { FileMentionMenu } from "@/components/file-mention";
import { useFileMention } from "@/components/file-mention/use-file-mention";
import { ShortcutsDialogContent } from "@/components/dialog/shortcuts-dialog";

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
    { name: "return", action: "submit" },
    { name: "enter", action: "submit" },
    { name: "return", shift: true, action: "newline" },
    { name: "enter", shift: true, action: "newline" },
]

type InputBarProps = {
    onSubmit: (value: string) => void;
    disabled?: boolean;
    onClear?: () => void;
    messageCount?: number;
    sessionTitle?: string;
}

export function InputBar({ onSubmit, disabled = false, onClear, messageCount, sessionTitle }: InputBarProps) {
    const textareaRef = useRef<TextareaRenderable>(null);
    const onSubmitRef = useRef<() => void>(() => { });

    const renderer = useRenderer();
    const toast = useToast();
    const { isTopLayer, setResponder } = useKeyboardLayer();
    const dialog = useDialog();
    const { colors } = useTheme();
    const navigate = useNavigate();
    const { mode, toggleMode, setModel, setMode } = usePromptConfig();

    const {
        showCommandMenu,
        commandQuery,
        selectedIndex: commandSelectedIndex,
        scrollRef: commandScrollRef,
        handleContentChange,
        resolveCommand,
        setSelectedIndex: setCommandSelectedIndex,
    } = useCommandMenu();

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
                const combined = userText ? `${content}\n\n${userText}` : content;
                textarea.setText("");
                onSubmit(combined);
            } else {
                toast.show({ 
                    message: `Skill "${skillMatch[1]}" not found`, 
                    variant: "error" 
                });
            }
            return;
        }

        onSubmit(text);
        textarea.setText("");
    }, [disabled, onSubmit]);

    const handleCommand = useCallback((command: Command | undefined) => {
        const textarea = textareaRef.current;
        if (!command || !textarea) return;
        textarea.setText("");
        if (command.action) {
            command.action({
                exit: () => renderer.destroy(),
                toast,
                dialog,
                navigate,
                mode,
                setMode,
                setModel,
                setInputValue: (value: string) => {
                    textarea.setText(value);
                    textarea.cursorOffset = value.length;
                },
                clearMessages: () => { onClear?.(); },
            });
        } else {
            textarea.insertText(command.value + " ");
        }
    }, [renderer, toast, dialog, navigate, mode, setMode, setModel, onClear]);

    const handleCommandExecute = useCallback((index: number) => {
        handleCommand(resolveCommand(index));
    }, [resolveCommand, handleCommand]);

    const handleTextareaContentChange = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        handleContentChange(textarea.plainText);
        syncMention(textarea.plainText, textarea.cursorOffset);
    }, [handleContentChange, syncMention]);

    const handleTextareaCursorChange = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        syncMention(textarea.plainText, textarea.cursorOffset);
    }, [syncMention]);

    // Wire up the textarea submit handler once so it always reads the latest state
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.onSubmit = () => { onSubmitRef.current(); };
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

        handleSubmit();
    };

    useKeyboard((key) => {
        if (disabled) return;
        if (!isTopLayer("base")) return;

        if (key.name === "tab") {
            key.preventDefault();
            toggleMode();
        }

        if (key.name === "slash" && !key.ctrl) {
            // Don't intercept if typing in textarea
        }

        if (key.name === "?" && key.ctrl) {
            key.preventDefault();
            dialog.open({
                title: "Keyboard Shortcuts",
                children: <ShortcutsDialogContent />,
            });
            return;
        }

        if (key.name === "backspace" && !showMentionMenu) {
            if (handleMentionBackspace()) {
                key.preventDefault();
            }
        }
    });

    useEffect(() => {
        setResponder("base", () => {
            if (disabled) return false;
            const textarea = textareaRef.current;
            if (textarea && textarea.plainText.length > 0) {
                textarea.setText("");
                return true;
            }
            return false;
        });
        return () => setResponder("base", null);
    }, [disabled, setResponder]);

    return (
        <box width="100%" alignItems="center">
            <box
                width="100%"
                border={["left"]}
                borderColor={getModeColor(mode, colors)}
                customBorderChars={{
                    ...EmptyBorder,
                    vertical: "┃",
                    bottomLeft: "╹",
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
                    <textarea
                        width="100%"
                        ref={textareaRef}
                        focused={!disabled && (isTopLayer("base") || isTopLayer("command") || isTopLayer("mention"))}
                        keyBindings={TEXTAREA_KEY_BINDINGS}
                        onContentChange={handleTextareaContentChange}
                        onCursorChange={handleTextareaCursorChange}
                        placeholder={mode === Mode.PLAN
                            ? "Describe what to plan... (@ for files)"
                            : "Describe what to build... (@ for files)"
                        }
                    />
                    <StatusBar messageCount={messageCount} sessionTitle={sessionTitle} />
                </box>
            </box>
        </box>
    );
}
