import React from "react";

import prettyMs from "pretty-ms";

import { Mode, type ModeType } from "@nightcode/shared";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "@/providers/theme";
import type { Message } from "@/hooks/use-chat";
import { getModeColor } from "@/lib/mode-utils";
import { getModelName } from "@/lib/model-names";
import { highlightCode } from "@/lib/syntax-highlight";
import { loadSettings } from "@/lib/settings";

import { EmptyBorder } from "@/components/border";
import { MarkdownText } from "@/lib/markdown";
import { ToolTimer } from "@/components/messages/tool-timer";

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<ClientMessagePart, { type: `tool-${string}` | "dynamic-tool" }>;

type BotMessageProps = {
    parts: ClientMessagePart[];
    model: string;
    mode: ModeType;
    durationMs?: number;
    streaming?: boolean;
};

function formatToolName(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase());
}

function isToolPart(part: ClientMessagePart): part is ToolPart {
    return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function formatToolArgs(tc: ToolPart): string {
    if (!("input" in tc) || tc.input == null) return "";
    if (typeof tc.input !== "object") return String(tc.input);

    return Object.values(tc.input).map(String).join(" ");
}

type PartGroup = {
    type: ClientMessagePart["type"];
    parts: ClientMessagePart[];
    key: string;
};

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
    const groups: PartGroup[] = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const lastGroup = groups[groups.length - 1];

        if (lastGroup && lastGroup.type === part.type) {
            lastGroup.parts.push(part);
        } else {
            const key = isToolPart(part)
                ? `group-tc-${part.toolCallId}`
                : `group-${part.type}-${i}`;

            groups.push({ type: part.type, parts: [part], key });
        }
    }

    return groups;
}

const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;

function renderHighlightedContent(text: string, colors: ReturnType<typeof useTheme>["colors"]): React.ReactNode[] {
    const settings = loadSettings();
    if (!settings.syntaxHighlight?.enabled) {
        return [<MarkdownText key="md">{text}</MarkdownText>];
    }

    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    CODE_BLOCK_REGEX.lastIndex = 0;
    while ((match = CODE_BLOCK_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const before = text.slice(lastIndex, match.index);
            nodes.push(
                <MarkdownText key={`text-${lastIndex}`}>{before}</MarkdownText>
            );
        }

        const langHint = match[1];
        const code = match[2]!;
        nodes.push(
            <box key={`code-${match.index}`} flexDirection="column" paddingX={1}>
                {highlightCode(code, langHint, colors)}
            </box>
        );

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        const remaining = text.slice(lastIndex);
        nodes.push(
            <MarkdownText key={`text-${lastIndex}`}>{remaining}</MarkdownText>
        );
    }

    return nodes.length > 0 ? nodes : [<MarkdownText key="md-fallback">{text}</MarkdownText>];
}

export const BotMessage = React.memo(function BotMessage({
    parts,
    model,
    mode,
    durationMs,
    streaming = false,
}: BotMessageProps) {
    const { colors } = useTheme();

    return (
        <box alignItems="center" width="100%">
            {groupConsecutiveParts(parts).map((group, i) => (
                <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
                    {group.parts.map((part, j) => {
                        if (part.type === "reasoning") {
                            return (
                                <box
                                    key={`reasoning-${j}`}
                                    border={["left"]}
                                    borderColor={colors.thinkingBorder}
                                    customBorderChars={{
                                        ...EmptyBorder,
                                        vertical: "│",
                                    }}
                                    width="100%"
                                    paddingX={2}
                                >
                                    <text attributes={TextAttributes.DIM}>
                                        <em fg={colors.thinking}>Thinking:</em>
                                    </text>
                                    <MarkdownText streaming={streaming} attributes={TextAttributes.DIM} fg={colors.dimSeparator}>{part.text}</MarkdownText>
                                </box>
                            );
                        }

                        if (isToolPart(part)) {
                            const toolName = part.type === "dynamic-tool"
                                ? part.toolName
                                : part.type.slice("tool-".length)

                            return (
                                <box
                                    key={part.toolCallId}
                                    border={["left"]}
                                    borderColor={colors.thinkingBorder}
                                    customBorderChars={{
                                        ...EmptyBorder,
                                        vertical: "│",
                                    }}
                                    width="100%"
                                    paddingX={2}
                                >
                                    <text attributes={TextAttributes.DIM}>
                                        <em fg={colors.info}>{formatToolName(toolName)}:</em>{" "}{formatToolArgs(part)}
                                        {part.state !== "output-available" && part.state !== "output-error"
                                            ? <ToolTimer />
                                            : ""
                                        }
                                        {part.state === "output-error" ? `${part.errorText}` : ""}
                                    </text>
                                </box>
                            );
                        }

                        if (part.type === "text") {
                            return (
                                <box key={`text-${j}`} paddingX={3} width="100%">
                                    {renderHighlightedContent(part.text, colors)}
                                </box>
                            );
                        }

                        return null;
                    })}
                </box>
            ))}

            <box paddingX={3} paddingY={1} gap={1} width="100%">
                <box flexDirection="row" gap={2}>
                    <text
                        fg={getModeColor(mode, colors)}
                    >
                        ◉
                    </text>
                    <box flexDirection="row" gap={1}>
                        <text>
                            {mode === Mode.PLAN ? "Plan" : "Build"}
                        </text>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                             ›
                        </text>
                        <text attributes={TextAttributes.DIM}>{getModelName(model)}</text>
                        {durationMs != null && (
                            <text attributes={TextAttributes.DIM}>
                                <em fg={colors.dimSeparator}> › </em>
                                {prettyMs(durationMs)}
                            </text>
                        )}
                    </box>
                </box>
            </box>
        </box>
    );
});
