import React from 'react';

import prettyMs from 'pretty-ms';

import { Mode, type ModeType } from '@nightcode/shared';
import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import type { Message } from '@/hooks/use-chat';
import { getModeColor } from '@/lib/mode-utils';
import {
    getModelName,
    getProviderDisplayName,
    extractProvider,
} from '@/lib/model-names';
import { highlightCode } from '@/lib/syntax-highlight';
import { loadSettings } from '@/lib/settings';
import { toUnifiedDiff } from '@/lib/diff-utils';

import { EmptyBorder } from '@/components/border';
import { MarkdownText } from '@/lib/markdown';
import { ToolTimer } from '@/components/messages/tool-timer';
import { SubagentProgressPanel } from '@/components/subagent-progress-panel';
import { TaskGraphView } from '@/components/task-graph';
import { TaskListPanel } from '@/components/task-list-panel';
import { QuestionResult } from '@/components/question-result';
import { useOrchestration } from '@/hooks/use-orchestration';
import { orchestratorManager } from '@/lib/orchestrator-manager';

type ClientMessagePart = Message['parts'][number];
type ToolPart = Extract<
    ClientMessagePart,
    { type: `tool-${string}` | 'dynamic-tool' }
>;

type BotMessageProps = {
    parts: ClientMessagePart[];
    model: string;
    mode: ModeType;
    durationMs?: number;
    streaming?: boolean;
};

function formatToolName(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase());
}

function isToolPart(part: ClientMessagePart): part is ToolPart {
    return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function formatToolArgs(tc: ToolPart): string {
    if (!('input' in tc) || tc.input == null) return '';
    if (typeof tc.input !== 'object') {
        const str = String(tc.input);
        return str.length > 60 ? str.slice(0, 57) + '...' : str;
    }

    const entries = Object.entries(tc.input);
    const summary = entries
        .map(([key, val]) => {
            const str = String(val ?? '');
            if (str.length > 40) {
                return `${key}: ${str.slice(0, 37)}...`;
            }
            return str;
        })
        .join(' ');

    return summary.length > 80 ? summary.slice(0, 77) + '...' : summary;
}

type PartGroup = {
    type: ClientMessagePart['type'];
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

function renderHighlightedContent(
    text: string,
    colors: ReturnType<typeof useTheme>['colors'],
    streaming = false,
): React.ReactNode[] {
    const settings = loadSettings();
    if (!settings.syntaxHighlight?.enabled) {
        return [
            <MarkdownText key="md" streaming={streaming}>
                {text}
            </MarkdownText>,
        ];
    }

    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    CODE_BLOCK_REGEX.lastIndex = 0;
    while ((match = CODE_BLOCK_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const before = text.slice(lastIndex, match.index);
            nodes.push(
                <MarkdownText key={`text-${lastIndex}`} streaming={streaming}>
                    {before}
                </MarkdownText>,
            );
        }

        const langHint = match[1];
        const code = match[2]!;
        nodes.push(
            <box
                key={`code-${match.index}`}
                flexDirection="column"
                paddingX={1}
            >
                {highlightCode(code, langHint, colors)}
            </box>,
        );

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        const remaining = text.slice(lastIndex);
        nodes.push(
            <MarkdownText key={`text-${lastIndex}`} streaming={streaming}>
                {remaining}
            </MarkdownText>,
        );
    }

    return nodes.length > 0
        ? nodes
        : [
              <MarkdownText key="md-fallback" streaming={streaming}>
                  {text}
              </MarkdownText>,
          ];
}

export const BotMessage = React.memo(function BotMessage({
    parts,
    model,
    mode,
    durationMs,
    streaming = false,
}: BotMessageProps) {
    const { colors } = useTheme();
    const { activeGraphs } = useOrchestration();

    return (
        <box alignItems="center" width="100%">
            {groupConsecutiveParts(parts).map((group, i) => (
                <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
                    {group.parts.map((part, j) => {
                        if (part.type === 'reasoning') {
                            return (
                                <box
                                    key={`reasoning-${j}`}
                                    border={['left']}
                                    borderColor={colors.thinkingBorder}
                                    customBorderChars={{
                                        ...EmptyBorder,
                                        vertical: '│',
                                    }}
                                    width="100%"
                                    paddingX={2}
                                >
                                    <text attributes={TextAttributes.DIM}>
                                        <em fg={colors.thinking}>◆ Thinking</em>
                                        :{streaming && <ToolTimer />}
                                    </text>
                                    <MarkdownText
                                        streaming={streaming}
                                        attributes={TextAttributes.DIM}
                                        fg={colors.dimSeparator}
                                    >
                                        {part.text}
                                    </MarkdownText>
                                </box>
                            );
                        }

                        if (isToolPart(part)) {
                            const toolName =
                                part.type === 'dynamic-tool'
                                    ? part.toolName
                                    : part.type.slice('tool-'.length);

                            const isRunning =
                                part.state !== 'output-available' &&
                                part.state !== 'output-error';
                            const isError = part.state === 'output-error';
                            const isComplete =
                                part.state === 'output-available' && !isError;
                            const statusIcon = isError
                                ? '✗'
                                : isComplete
                                  ? '✓'
                                  : '○';
                            const statusColor = isError
                                ? colors.error
                                : isComplete
                                  ? colors.success
                                  : colors.info;
                            const isSpawnAgent =
                                toolName === 'spawnAgent' ||
                                toolName === 'spawnCodeReviewer' ||
                                toolName === 'spawnTestWriter' ||
                                toolName === 'spawnDebugger' ||
                                toolName === 'spawnRefactor' ||
                                toolName === 'spawnResearcher';
                            const isOrchestrator = toolName === 'orchestrator';

                            const isEditFile = toolName === 'editFile';
                            const isWriteFile = toolName === 'writeFile';

                            // Find the graph for this orchestrator tool call
                            const graphForTool = isOrchestrator
                                ? orchestratorManager.getGraphForToolCall(
                                      part.toolCallId,
                                  )
                                : undefined;
                            const matchingGraph = graphForTool
                                ? activeGraphs.find(
                                      (g) => g.id === graphForTool,
                                  )
                                : undefined;

                            // Build unified diff for editFile/writeFile
                            let diffText: string | undefined;
                            if (
                                isEditFile &&
                                'input' in part &&
                                part.input &&
                                typeof part.input === 'object'
                            ) {
                                const input = part.input as Record<
                                    string,
                                    unknown
                                >;
                                const filePath = String(input.path ?? '');
                                const oldStr = String(input.oldString ?? '');
                                const newStr = String(input.newString ?? '');
                                if (filePath && (oldStr || newStr)) {
                                    diffText = toUnifiedDiff(
                                        filePath,
                                        oldStr,
                                        newStr,
                                    );
                                }
                            } else if (
                                isWriteFile &&
                                'input' in part &&
                                part.input &&
                                typeof part.input === 'object'
                            ) {
                                const input = part.input as Record<
                                    string,
                                    unknown
                                >;
                                const filePath = String(input.path ?? '');
                                const content = String(input.content ?? '');
                                if (filePath && content) {
                                    const lines = content.split('\n');
                                    const added = lines
                                        .map((l) => `+${l}`)
                                        .join('\n');
                                    diffText = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${added}`;
                                }
                            }

                            return (
                                <box
                                    key={part.toolCallId}
                                    flexDirection="column"
                                    width="100%"
                                >
                                    <box
                                        border={['left']}
                                        borderColor={
                                            isError
                                                ? colors.error
                                                : isComplete
                                                  ? colors.success
                                                  : colors.thinkingBorder
                                        }
                                        customBorderChars={{
                                            ...EmptyBorder,
                                            vertical: '│',
                                        }}
                                        width="100%"
                                        paddingX={2}
                                    >
                                        <text attributes={TextAttributes.DIM}>
                                            <em fg={statusColor}>
                                                {statusIcon}{' '}
                                            </em>
                                            <em fg={colors.info}>
                                                {formatToolName(toolName)}:
                                            </em>{' '}
                                            {isEditFile || isWriteFile ? (
                                                <em fg={colors.dimSeparator}>
                                                    {String(
                                                        (
                                                            part.input as Record<
                                                                string,
                                                                unknown
                                                            >
                                                        )?.path ?? '',
                                                    )}
                                                </em>
                                            ) : (
                                                formatToolArgs(part)
                                            )}
                                            {isRunning && <ToolTimer />}
                                        </text>
                                    </box>
                                    {/* Show inline diff for editFile/writeFile */}
                                    {(isEditFile || isWriteFile) &&
                                        diffText &&
                                        isComplete && (
                                            <box paddingLeft={2} width="100%">
                                                <diff
                                                    view="split"
                                                    diff={diffText}
                                                    showLineNumbers
                                                />
                                            </box>
                                        )}
                                    {/* Show inline subagent progress for spawnAgent tools */}
                                    {isSpawnAgent && isRunning && (
                                        <SubagentProgressPanel
                                            toolCallId={part.toolCallId}
                                        />
                                    )}
                                    {/* Show inline task graph for orchestrator tools */}
                                    {isOrchestrator &&
                                    isRunning &&
                                    matchingGraph ? (
                                        <box paddingLeft={2} width="100%">
                                            <TaskGraphView
                                                graph={matchingGraph}
                                                compact
                                            />
                                        </box>
                                    ) : null}
                                    {/* Show inline task list for taskList tools — only on the last one */}
                                    {toolName === 'taskList' &&
                                        (() => {
                                            // Find the last taskList tool call in this message
                                            const allToolParts =
                                                parts.filter(isToolPart);
                                            const lastTaskListIdx =
                                                allToolParts.findLastIndex(
                                                    (p) => {
                                                        const name =
                                                            p.type ===
                                                            'dynamic-tool'
                                                                ? p.toolName
                                                                : p.type.slice(
                                                                      'tool-'
                                                                          .length,
                                                                  );
                                                        return (
                                                            name === 'taskList'
                                                        );
                                                    },
                                                );
                                            const thisIdx =
                                                allToolParts.indexOf(part);
                                            if (thisIdx !== lastTaskListIdx)
                                                return null;
                                            return (
                                                <box
                                                    paddingLeft={2}
                                                    width="100%"
                                                >
                                                    <TaskListPanel />
                                                </box>
                                            );
                                        })()}
                                    {/* Show QuestionResult for askQuestion tools */}
                                    {toolName === 'askQuestion' &&
                                        isComplete &&
                                        'output' in part &&
                                        !!part.output && (
                                            <box paddingLeft={2} width="100%">
                                                <QuestionResult
                                                    questions={
                                                        (
                                                            part.input as Record<
                                                                string,
                                                                unknown
                                                            >
                                                        )?.questions
                                                            ? (
                                                                  (
                                                                      part.input as Record<
                                                                          string,
                                                                          unknown
                                                                      >
                                                                  )
                                                                      .questions as Array<{
                                                                      question: string;
                                                                  }>
                                                              ).map(
                                                                  (q) =>
                                                                      q.question,
                                                              )
                                                            : []
                                                    }
                                                    answers={
                                                        Array.isArray(
                                                            (
                                                                part.output as Record<
                                                                    string,
                                                                    unknown
                                                                >
                                                            )?.answers,
                                                        )
                                                            ? ((
                                                                  part.output as Record<
                                                                      string,
                                                                      unknown
                                                                  >
                                                              )
                                                                  .answers as string[])
                                                            : []
                                                    }
                                                />
                                            </box>
                                        )}
                                </box>
                            );
                        }

                        if (part.type === 'text') {
                            return (
                                <box
                                    key={`text-${j}`}
                                    paddingX={3}
                                    width="100%"
                                >
                                    {renderHighlightedContent(
                                        part.text,
                                        colors,
                                        streaming,
                                    )}
                                </box>
                            );
                        }

                        return null;
                    })}
                </box>
            ))}

            <box paddingX={3} paddingY={1} gap={1} width="100%">
                <box flexDirection="row" gap={2}>
                    <text fg={getModeColor(mode, colors)}>◉</text>
                    <box flexDirection="row" gap={1}>
                        <text>{mode === Mode.PLAN ? 'Plan' : 'Build'}</text>
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            ›
                        </text>
                        <text attributes={TextAttributes.DIM}>
                            {getModelName(model)}
                        </text>
                        <text
                            attributes={TextAttributes.DIM}
                            fg={colors.dimSeparator}
                        >
                            {getProviderDisplayName(extractProvider(model))}
                        </text>
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
