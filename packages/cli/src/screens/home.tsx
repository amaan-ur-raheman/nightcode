import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router";

import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { usePromptConfig } from "@/providers/prompt-config";
import { useKeyboardLayer } from "@/providers/keyboard-layer";
import { useTheme } from "@/providers/theme";

import { Header } from "@/components/header";
import { InputBar } from "@/components/input-bar";
import { KeyHint } from "@/components/key-hint";

type HomeProps = {
    savedSession?: { id: string; title: string } | null;
};

export function Home({ savedSession }: HomeProps) {
    const navigate = useNavigate();
    const renderer = useRenderer();
    const { mode, model } = usePromptConfig();
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();

    // Pre-warm common tools during idle so first tool call is instant
    useEffect(() => {
        import("@/lib/tools/index").then(({ loadTool }) => {
            void Promise.allSettled([
                loadTool("readFile"),
                loadTool("grep"),
                loadTool("glob"),
                loadTool("listDirectory"),
                loadTool("bash"),
                loadTool("editFile"),
            ]);
        });
    }, []);

    const handleSubmit = useCallback((text: string) => {
        navigate("/sessions/new", { state: { message: text, mode, model } });
    }, [navigate, mode, model]);

    useKeyboard((key) => {
        if (!isTopLayer("base")) return;
        if (savedSession && key.ctrl && (key.name === "y" || key.name === "n")) {
            key.preventDefault();
            if (key.name === "y") {
                navigate(`/sessions/${savedSession.id}`);
            }
            // On 'n', do nothing — just stay on home
        }
    });

    return (
        <box
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
            gap={2}
            position="relative"
            width="100%"
            height="100%"
        >
            <Header />
            <box width="100%" maxWidth={78} paddingX={2} flexDirection="column" gap={1}>
                {savedSession ? (
                    <box flexDirection="column" gap={0} marginBottom={1}>
                        <text>
                            <em fg={colors.dimSeparator}>Last session: </em>
                            <em fg={colors.primary}>{savedSession.title || "Untitled"}</em>
                        </text>
                        <text attributes={TextAttributes.DIM}>
                            Press ctrl+y to resume, or start a new conversation below
                        </text>
                    </box>
                ) : null}
                <InputBar onSubmit={handleSubmit} />
                <box flexDirection="column" gap={1} marginTop={1}>
                    <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
                        <KeyHint keyName="tab" label="agents" />
                    </box>
                    <box flexDirection="row" gap={2} flexShrink={0} marginLeft="auto">
                        <text attributes={TextAttributes.DIM}>↑ history</text>
                        <text attributes={TextAttributes.DIM}>/help commands</text>
                    </box>
                </box>
            </box>
        </box>
    );
}
