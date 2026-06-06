import { z } from "zod";
import type { InferResponseType } from "hono/client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router";

import { useKeyboard, useSelectionHandler } from "@opentui/react";
import { type ModeType, type SupportedChatModelId } from "@nightcode/shared";

import { useChat } from "@/hooks/use-chat";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/http-errors";
import type { Message } from "@/hooks/use-chat";

import { useToast } from "@/providers/toast";
import { usePromptConfig } from "@/providers/prompt-config";
import { useKeyboardLayer } from "@/providers/keyboard-layer";

import { SessionShell } from "@/components/session-shell";
import {
    UserMessage,
    ErrorMessage,
    BotMessage
} from "@/components/messages";

type SessionData = InferResponseType<(typeof apiClient.sessions)[":id"]["$get"], 200>;

const sessionLocationSchema = z.object({
    session: z.custom<SessionData>(
        (val) => val !== null && typeof val === "object" && "id" in val
    ),
    initialPrompt: z
        .object({
            message: z.string(),
            mode: z.custom<ModeType>(),
            model: z.custom<SupportedChatModelId>()
        })
        .optional()
});

function ChatMessage(
    { msg, streaming = false }: { msg: Message; streaming?: boolean }
) {
    if (msg.role === "user") {
        const text = msg.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("");

        return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"} />;
    }

    return (
        <BotMessage
            parts={msg.parts}
            mode={msg.metadata?.mode ?? "BUILD"}
            model={msg.metadata?.model ?? "Unknown"}
            durationMs={msg.metadata?.durationMs}
            streaming={streaming}
        />
    )
}

import { lastSession } from "@/index";

function SessionChat({
    session,
    initialPrompt
}: {
    session: SessionData;
    initialPrompt?: {
        message: string;
        mode: ModeType,
        model: SupportedChatModelId
    }
}) {
    const [initialMessages] = useState(session.messages as unknown as Message[]);
    const { mode, model} = usePromptConfig();
    const { isTopLayer } = useKeyboardLayer();
    const { messages, submit, abort, status, interrupt, error, isLoading } = useChat(
        session.id,
        initialMessages
    );
    const hasSubmittedInitialPromptRef = useRef(false);

    lastSession.id = session.id;
    lastSession.title = session.title;

    // Stop any pending replies when the user leaves this session
    useEffect(() => {
        return () => {
            void abort();
        }
    }, [abort]);

    // Let the user cancel a reply even before the first streamed chunks arrived
    useKeyboard((key) => {
        if (key.name === "escape" && isTopLayer("base") && isLoading) {
            key.preventDefault();
            interrupt();
       }
    });

    const toast = useToast();

    useSelectionHandler((selection) => {
        const text = selection.getSelectedText();
        if (!text) return;

        (async () => {
            try {
            if (typeof navigator !== "undefined" && (navigator as any).clipboard?.writeText) {
                try {
                    await (navigator as any).clipboard.writeText(text);
                    return;
                } catch {
                    // Fallback to command line if navigator.clipboard fails
                }
            }

            const platform = process.platform;
            let commands: string[][];
            if (platform === "darwin") {
                commands = [["pbcopy"]];
            } else if (platform === "win32") {
                commands = [["clip"]];
            } else if (platform === "linux") {
                commands = [["xclip", "-selection", "clipboard"], ["wl-copy"]];
            } else {
                commands = [["xclip", "-selection", "clipboard"], ["wl-copy"], ["pbcopy"], ["clip"]];
            }

            let lastError: unknown = null;
            for (const cmd of commands) {
                try {
                    const proc = Bun.spawn(cmd, { stdin: "pipe" });
                    proc.stdin.write(text);
                    await proc.stdin.end();
                    const exitCode = await proc.exited;
                    if (exitCode === 0) {
                        return;
                    }
                    lastError = new Error(`${cmd[0]} exited with code ${exitCode}`);
                } catch (err) {
                    lastError = err;
                }
            }

            toast.show({
                variant: "error",
                message: lastError instanceof Error ? lastError.message : "Failed to copy selection to clipboard",
            });
            } catch (err) {
                toast.show({
                    variant: "error",
                    message: err instanceof Error ? err.message : "Failed to copy selection to clipboard",
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

    return (
        <SessionShell
            onSubmit={(text) =>
                submit({ userText: text, mode, model })
            }
            loading={isLoading}
            interruptible={isLoading}
        >
            {messages.map((msg, i) => (
                <ChatMessage
                    key={msg.id}
                    msg={msg}
                    streaming={status === "streaming" && i === messages.length - 1}
                />
            ))}
            {error && <ErrorMessage message={error.message} />}
        </SessionShell>
    )
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

    const [session, setSession] = useState<SessionData | null>(prefetched?.session ?? null);

    useEffect(() => {
        // Skip fetch if session was passed via location state
        if (prefetched?.session) return;

        setSession(null);

        if (!id) return;

        let ignore = false;
        const fetchSession = async () => {
            try {
                const res = await apiClient.sessions[":id"].$get(
                    { param: { id } }
                );

                if (ignore) return;
                if (!res.ok) throw new Error(await getErrorMessage(res));

                const resolved = await res.json();
                setSession(resolved);
            } catch (err) {
                if (ignore) return;
                toast.show({
                    variant: "error",
                    message: err instanceof Error ? err.message : "Failed to load session",
                });
                navigate("/", { replace: true });
            }
        };

        fetchSession();
        return () => {
            ignore = true;
        };
    }, [id, prefetched, toast, navigate]);

    if (!session) {
        return (
            <SessionShell
                onSubmit={() => { }}
                inputDisabled
                loading
            />
        );
    }

    return (
        <SessionChat
            key={session.id}
            session={session}
            initialPrompt={prefetched?.initialPrompt}
        />
    );
}
