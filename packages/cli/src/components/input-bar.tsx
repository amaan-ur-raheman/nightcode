import { useNavigate } from "react-router";
import { useRef, useCallback, useEffect } from "react";

import { Mode } from "@nightcode/database/enums";
import { useRenderer, useKeyboard } from "@opentui/react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";

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

type InputBarProps = {
    onSubmit: (value: string) => void;
    disabled?: boolean;
}

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
    { name: "return", action: "submit" },
    { name: "enter", action: "submit" },
    { name: "return", shift: true, action: "newline" },
    { name: "enter", shift: true, action: "newline" },
]

export function InputBar({ onSubmit, disabled = false }: InputBarProps) {
    const textareaRef = useRef<TextareaRenderable>(null);
    const onSubmitRef = useRef<() => void>(() => { });
    const renderer = useRenderer();
    const toast = useToast();
    const { isTopLayer, setResponder } = useKeyboardLayer();
    const dialog = useDialog();
    const { colors } = useTheme();
    const navigate = useNavigate();
    const { mode, toggleMode, model, setModel, setMode } = usePromptConfig();

    const {
        showCommandMenu,
        commandQuery,
        selectedIndex,
        scrollRef,
        handleContentChange,
        resolveCommand,
        setSelectedIndex,
    } = useCommandMenu();

    const handleTextareaContentChange = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        handleContentChange(textarea.plainText);
    }, [handleContentChange]);

    const handleSubmit = useCallback(() => {
        if (disabled) return;

        const textarea = textareaRef.current;
        if (!textarea) return;

        const text = textarea.plainText.trim();
        if (text.length === 0) return;

        onSubmit(text);
        textarea.setText("");
    }, [disabled, onSubmit]);

    const handleCommand = useCallback((
        command: Command | undefined,
    ) => {
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
                setModel
            });
        } else {
            textarea.insertText(command.value + " ");
        }
    }, [renderer, toast, dialog, navigate, mode, setMode, setModel]);

    const handleCommandExecute = useCallback(
        (index: number) => {
            const command = resolveCommand(index);
            handleCommand(command);
        },
        [resolveCommand, handleCommand]
    );

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
            const command = resolveCommand(selectedIndex);
            handleCommand(command);
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
    });

    // Register the base layer responder for ctrl+c dismissal
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
                borderColor={mode === Mode.PLAN ? colors.planMode : colors.primary}
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
                                selectedIndex={selectedIndex}
                                scrollRef={scrollRef}
                                onSelect={setSelectedIndex}
                                onExecute={handleCommandExecute}
                            />
                        </box>
                    )}
                    <textarea
                        width="100%"
                        ref={textareaRef}
                        focused={!disabled && (isTopLayer("base") || isTopLayer("command"))}
                        keyBindings={TEXTAREA_KEY_BINDINGS}
                        onContentChange={handleTextareaContentChange}
                        placeholder={`Ask anything... "Fix a bug in the database"`}
                    />
                    <StatusBar />
                </box>
            </box>
        </box>
    )
}
