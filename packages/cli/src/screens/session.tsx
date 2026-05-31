import { z } from "zod";
import prettyMs from "pretty-ms";
import type { InferResponseType } from "hono/client";
import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router";

import { useChat } from "@/hooks/use-chat";
import { useToast } from "@/providers/toast";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/http-errors";
import type { Message, ClientMessagePart } from "@/hooks/use-chat";
import { DEFAULT_CHAT_MODEL_ID, type SupportedChatModelId } from "@nightcode/shared";

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
    )
});

function mapDBMessages(dbMessages: SessionData["messages"]): Message[] {
    return dbMessages.map((m): Message => {
        if (m.role === "ERROR") {
            return { id: m.id, role: "error", content: m.content };
        }

        if (m.role === "USER") {
            return {
                id: m.id,
                role: "user",
                content: m.content,
                mode: m.mode,
                model: m.model as SupportedChatModelId
            };
        }

        return {
            id: m.id,
            role: "assistant",
            content: m.content,
            model: m.model as SupportedChatModelId,
            mode: m.mode,
            parts: [{ type: "text", text: m.content }],
            ...(m.duration != null ? { duration: prettyMs(m.duration) } : {})
        };
    })
}

function ChatMessage(
    { msg }: { msg: Message }
) {
    if (msg.role === "user") {
        return <UserMessage message={msg.content} />;
    }

    if (msg.role === "error") {
        return <ErrorMessage message={msg.content} />;
    }

    return (
        <BotMessage
            parts={msg.parts}
            mode={msg.mode}
            model={msg.model}
            duration={msg.duration}
            streaming={false}
        />
    )
}

function SessionChat({ session }: { session: SessionData }) {
    const [initialMessages] = useState(() => mapDBMessages(session.messages));
    const { messages, submit, abort, streaming } = useChat(session.id, initialMessages);

    // Stop any pending replies when the user leaves this session
    useEffect(() => {
        return () => abort();
    }, [abort]);

    return (
        <SessionShell
            onSubmit={(text) =>
                submit({ userText: text, mode: "BUILD", model: DEFAULT_CHAT_MODEL_ID })
            }
            loading={streaming.status === "streaming"}
        >
            {messages.map((msg) => (
                <ChatMessage key={msg.id} msg={msg} />
            ))}
            {streaming.status === "streaming" && streaming.parts.length > 0 && (
                <BotMessage
                    parts={streaming.parts}
                    model={streaming.model}
                    mode={streaming.mode}
                    streaming
                />
            )}
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
        return parsed.success ? parsed.data.session : null;
    }, [location.state]);

    const [session, setSession] = useState<SessionData | null>(prefetched);

    useEffect(() => {
        // Skip fetch if session was passed via location state
        if (prefetched) return;

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
        <SessionChat key={session.id} session={session}/>
    );
}
