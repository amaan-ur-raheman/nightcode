import type { ReactNode } from "react";

import { TextAttributes } from "@opentui/core";
import { usePromptConfig } from "@/providers/prompt-config";

import { Spinner } from "@/components/spinner";
import { InputBar } from "@/components/input-bar";
import { KeyHint } from "@/components/key-hint";

type SessionShellProps = {
    children?: ReactNode;
    onSubmit: (text: string) => void;
    onClear?: () => void;
    inputDisabled?: boolean;
    loading?: boolean;
    interruptible?: boolean;
    canRetry?: boolean;
    runningToolName?: string | null;
    messageCount?: number;
    sessionTitle?: string;
};

export function SessionShell({
    children,
    onSubmit,
    onClear,
    inputDisabled = false,
    loading = false,
    interruptible = false,
    canRetry = false,
    runningToolName,
    messageCount,
    sessionTitle,
}: SessionShellProps) {
    const { mode } = usePromptConfig();

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
            <scrollbox flexGrow={1} width="100%" stickyScroll stickyStart="bottom">
                <box width="100%" flexDirection="column">{children}</box>
            </scrollbox>
            <box flexShrink={0}>
                <InputBar onSubmit={onSubmit} disabled={inputDisabled} onClear={onClear} messageCount={messageCount} sessionTitle={sessionTitle} />
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
                            {runningToolName
                                ? <text attributes={TextAttributes.DIM}>{`running ${runningToolName}...`}</text>
                                : interruptible
                                    ? <text attributes={TextAttributes.DIM}>esc to interrupt</text>
                                    : null
                            }
                        </>
                    ) : null}
                </box>

                <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
                    {canRetry ? <KeyHint keyName="ctrl+r" label="retry" /> : null}
                    <KeyHint keyName="tab" label="agents" />
                </box>
            </box>
        </box>
    );
}
