import React, { useState } from 'react';

import prettyMs from 'pretty-ms';

import { Mode, type ModeType } from '@nightcode/shared';
import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import type { Message } from '@/hooks/use-chat';
import { getModeColor } from '@/lib/mode-utils';
import { getModelName } from '@/lib/model-names';
import { highlightCode } from '@/lib/syntax-highlight';
import { loadSettings } from '@/lib/settings';
import { toUnifiedDiff } from '@/lib/diff-utils';
import { type ThemeColors } from '@/theme';

import { ToolBorder } from '@/components/border';
import { MarkdownText } from '@/lib/markdown';
import { ToolTimer } from '@/components/messages/tool-timer';
import { SubagentProgressPanel } from '@/components/subagent-progress-panel';
import { TaskGraphView } from '@/components/task-graph';
import { TaskListPanel } from '@/components/task-list-panel';
import { QuestionResult } from '@/components/question-result';
import { useOrchestration } from '@/hooks/use-orchestration';
import {
    SearchMatchesBlock,
    GitStatusBlock,
    SecretScanBlock,
    ProfileCodeBlock,
    GitLogTimelineBlock,
    parseGitShortStatus,
} from './enhanced-tool-outputs';
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
    if (entries.length === 0) return '';

    // If it's a single simple argument (like command, query, etc.), show just the value
    if (entries.length === 1) {
        const [key, val] = entries[0]!;
        if (typeof val !== 'object' || val === null) {
            const str = String(val ?? '');
            return str.length > 80 ? str.slice(0, 77) + '...' : str;
        }
    }

    const summary = entries
        .map(([key, val]) => {
            let str = '';
            if (typeof val === 'object' && val !== null) {
                try {
                    str = JSON.stringify(val);
                } catch {
                    str = String(val);
                }
            } else {
                str = String(val ?? '');
            }
            if (str.length > 40) {
                return `${key}: ${str.slice(0, 37)}...`;
            }
            return `${key}: ${str}`;
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

function BashTerminalBlock({
    command,
    output,
    colors,
}: {
    command: string;
    output?: { stdout: string; stderr: string; exitCode: number } | null;
    colors: ThemeColors;
}) {
    const [collapsed, setCollapsed] = useState(true);

    const lines = command.split('\n');
    const renderedCommand = lines.map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            return (
                <text key={`cmd-c-${idx}`} fg={colors.dimSeparator}>
                    {line}
                </text>
            );
        } else if (trimmed) {
            const highlighted = highlightCode(line, 'shell', colors, true);
            return (
                <box key={`cmd-l-${idx}`} flexDirection="row">
                    <text fg={colors.dimSeparator}>$ </text>
                    {highlighted}
                </box>
            );
        } else {
            return <text key={`cmd-e-${idx}`}>{''}</text>;
        }
    });

    const stdout = output?.stdout ?? '';
    const stderr = output?.stderr ?? '';

    const renderedOutput: React.ReactNode[] = [];
    const ERROR_PATTERN =
        /^\s*(error:|fatal:|panic:|cannot|permission denied|no such file|not found|failed|ERR!)/i;

    if (stdout.trim()) {
        const stdoutLines = stdout.split('\n');
        renderedOutput.push(
            ...stdoutLines.map((line, i) => (
                <text key={`s-${i}`} fg={colors.text}>
                    {line}
                </text>
            )),
        );
    }

    if (stderr.trim()) {
        const stderrLines = stderr.split('\n');
        renderedOutput.push(
            ...stderrLines.map((line, i) => (
                <text
                    key={`e-${i}`}
                    fg={
                        ERROR_PATTERN.test(line)
                            ? colors.error
                            : colors.dimSeparator
                    }
                >
                    {line}
                </text>
            )),
        );
    }

    const hasOutput = renderedOutput.length > 0;
    const isLong = renderedOutput.length > 15;

    return (
        <box paddingLeft={2} paddingRight={1} width="100%">
            <box
                flexDirection="column"
                paddingX={2}
                paddingY={1}
                backgroundColor={colors.surface}
                width="100%"
                marginBottom={1}
            >
                {renderedCommand}
                {hasOutput && (
                    <>
                        <text>{''}</text>
                        {isLong ? (
                            <box flexDirection="column" width="100%">
                                <box
                                    {...({
                                        onClick: () => setCollapsed((c) => !c),
                                    } as any)}
                                    flexDirection="row"
                                    gap={1}
                                >
                                    <text fg={colors.dimSeparator}>
                                        {collapsed ? '▸' : '▾'}
                                    </text>
                                    <text fg={colors.dimSeparator}>
                                        {collapsed
                                            ? `${renderedOutput.length} lines of output (click to expand)`
                                            : 'click to collapse output'}
                                    </text>
                                </box>
                                {!collapsed && renderedOutput}
                            </box>
                        ) : (
                            renderedOutput
                        )}
                    </>
                )}
            </box>
        </box>
    );
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
                                    customBorderChars={ToolBorder}
                                    width="100%"
                                    paddingX={2}
                                >
                                    <text attributes={TextAttributes.DIM}>
                                        <em fg={colors.thinking}>◆ Thinking</em>
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
                                toolName === 'spawn_agent' ||
                                toolName === 'spawnAgent' ||
                                toolName === 'spawnCodeReviewer' ||
                                toolName === 'spawnTestWriter' ||
                                toolName === 'spawnDebugger' ||
                                toolName === 'spawnRefactor' ||
                                toolName === 'spawnResearcher';
                            const isOrchestrator =
                                toolName === 'orchestrate_task' ||
                                toolName === 'orchestrator';

                            const isEditFile =
                                toolName === 'edit_file' ||
                                toolName === 'editFile';
                            const isWriteFile =
                                toolName === 'write_file' ||
                                toolName === 'writeFile';

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
                            let filePath: string | undefined;

                            // Try to retrieve the diff directly from the tool output first
                            if (
                                isComplete &&
                                'output' in part &&
                                part.output &&
                                typeof part.output === 'object' &&
                                'diff' in part.output &&
                                typeof (part.output as any).diff === 'string'
                            ) {
                                diffText = (part.output as any).diff;
                                if (
                                    'input' in part &&
                                    part.input &&
                                    typeof part.input === 'object'
                                ) {
                                    filePath = String(
                                        (part.input as any).path ?? '',
                                    );
                                }
                            }

                            if (!diffText) {
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
                                    filePath = String(input.path ?? '');
                                    const oldStr = String(
                                        input.oldString ?? '',
                                    );
                                    const newStr = String(
                                        input.newString ?? '',
                                    );
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
                                    filePath = String(input.path ?? '');
                                    const content = String(input.content ?? '');
                                    if (filePath && content) {
                                        const lines = content.split('\n');
                                        const added = lines
                                            .map((l) => `+${l}`)
                                            .join('\n');
                                        diffText = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${added}`;
                                    }
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
                                        customBorderChars={ToolBorder}
                                        width="100%"
                                        paddingX={2}
                                        marginBottom={1}
                                    >
                                        <text>
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
                                                        )?.path ??
                                                            (
                                                                part.input as Record<
                                                                    string,
                                                                    unknown
                                                                >
                                                            )?.glob ??
                                                            '',
                                                    )}
                                                </em>
                                            ) : toolName === 'bash' ||
                                              (toolName === 'run_command' &&
                                                  (part.input as any)
                                                      ?.action ===
                                                      'bash') ? null : (
                                                formatToolArgs(part)
                                            )}
                                            {isRunning && <ToolTimer />}
                                        </text>
                                    </box>

                                    {/* Show inline terminal for bash tool */}
                                    {(toolName === 'bash' ||
                                        (toolName === 'run_command' &&
                                            (part.input as any)?.action ===
                                                'bash')) &&
                                    'input' in part &&
                                    part.input &&
                                    typeof part.input === 'object' ? (
                                        <BashTerminalBlock
                                            command={String(
                                                (part.input as any).command ??
                                                    '',
                                            )}
                                            output={
                                                isComplete &&
                                                'output' in part &&
                                                part.output &&
                                                typeof part.output === 'object'
                                                    ? (part.output as any)
                                                    : null
                                            }
                                            colors={colors}
                                        />
                                    ) : null}

                                    {/* Show inline search matches for grep/codeSearch */}
                                    {(toolName === 'grep' ||
                                        toolName === 'codeSearch' ||
                                        toolName === 'code_search') &&
                                    isComplete &&
                                    'output' in part &&
                                    part.output &&
                                    typeof part.output === 'object' ? (
                                        <SearchMatchesBlock
                                            matches={
                                                (part.output as any).matches ??
                                                []
                                            }
                                            colors={colors}
                                        />
                                    ) : null}

                                    {/* Show inline status for gitStatus/gitStatusExtended */}
                                    {(toolName === 'gitStatus' ||
                                        toolName === 'gitStatusExtended' ||
                                        (toolName === 'git_operation' &&
                                            (part.input as any)?.action ===
                                                'status')) &&
                                    isComplete &&
                                    'output' in part &&
                                    part.output &&
                                    typeof part.output === 'object'
                                        ? (() => {
                                              const out = part.output as any;
                                              if (
                                                  (toolName === 'gitStatus' ||
                                                      toolName ===
                                                          'git_operation') &&
                                                  typeof out.status === 'string'
                                              ) {
                                                  const parsed =
                                                      parseGitShortStatus(
                                                          out.status,
                                                      );
                                                  return (
                                                      <GitStatusBlock
                                                          staged={parsed.staged}
                                                          unstaged={
                                                              parsed.unstaged
                                                          }
                                                          untracked={
                                                              parsed.untracked
                                                          }
                                                          currentBranch={
                                                              parsed.currentBranch
                                                          }
                                                          colors={colors}
                                                      />
                                                  );
                                              }
                                              return (
                                                  <GitStatusBlock
                                                      staged={out.staged ?? []}
                                                      unstaged={
                                                          out.unstaged ?? []
                                                      }
                                                      untracked={
                                                          out.untracked ?? []
                                                      }
                                                      currentBranch={
                                                          out.currentBranch
                                                      }
                                                      colors={colors}
                                                  />
                                              );
                                          })()
                                        : null}

                                    {/* Show inline secrets for secretScan */}
                                    {toolName === 'secretScan' &&
                                    isComplete &&
                                    'output' in part &&
                                    part.output &&
                                    typeof part.output === 'object' ? (
                                        <SecretScanBlock
                                            secrets={
                                                (part.output as any).secrets ??
                                                []
                                            }
                                            colors={colors}
                                        />
                                    ) : null}

                                    {/* Show inline profile results for profileCode */}
                                    {(toolName === 'profileCode' ||
                                        (toolName === 'run_command' &&
                                            (part.input as any)?.action ===
                                                'profile_code')) &&
                                    isComplete &&
                                    'output' in part &&
                                    part.output &&
                                    typeof part.output === 'object' ? (
                                        <ProfileCodeBlock
                                            summary={String(
                                                (part.output as any).summary ??
                                                    '',
                                            )}
                                            hotspots={
                                                (part.output as any).hotspots ??
                                                []
                                            }
                                            topPerformers={
                                                (part.output as any)
                                                    .topPerformers ?? []
                                            }
                                            durationMs={Number(
                                                (part.output as any)
                                                    .durationMs ?? 0,
                                            )}
                                            colors={colors}
                                        />
                                    ) : null}

                                    {/* Show inline timeline for gitLog */}
                                    {(toolName === 'gitLog' ||
                                        (toolName === 'git_operation' &&
                                            (part.input as any)?.action ===
                                                'log')) &&
                                    isComplete &&
                                    'output' in part &&
                                    part.output &&
                                    typeof part.output === 'object' ? (
                                        <GitLogTimelineBlock
                                            commits={
                                                (part.output as any).commits ??
                                                []
                                            }
                                            colors={colors}
                                        />
                                    ) : null}

                                    {/* Show inline diff for editFile/writeFile */}
                                    {(isEditFile || isWriteFile) &&
                                        !!diffText &&
                                        isComplete && (
                                            <box paddingLeft={2} width="100%">
                                                <box
                                                    backgroundColor={
                                                        colors.surface
                                                    }
                                                    width="100%"
                                                >
                                                    <diff
                                                        view={
                                                            isWriteFile
                                                                ? 'unified'
                                                                : 'split'
                                                        }
                                                        diff={diffText}
                                                        showLineNumbers
                                                        filetype={
                                                            filePath
                                                                ? filePath
                                                                      .split(
                                                                          '.',
                                                                      )
                                                                      .pop()
                                                                      ?.toLowerCase()
                                                                : undefined
                                                        }
                                                    />
                                                </box>
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
                                        <box width="100%">
                                            <TaskGraphView
                                                graph={matchingGraph}
                                                compact
                                            />
                                        </box>
                                    ) : null}
                                    {/* Show inline task list for taskList tools — only on the last one */}
                                    {(toolName === 'taskList' ||
                                        (toolName === 'orchestrate_task' &&
                                            (
                                                part.input as any
                                            )?.action?.startsWith(
                                                'checklist_',
                                            ))) &&
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
                                                            name ===
                                                                'taskList' ||
                                                            (name ===
                                                                'orchestrate_task' &&
                                                                (
                                                                    p.input as any
                                                                )?.action?.startsWith(
                                                                    'checklist_',
                                                                ))
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
                                    {(toolName === 'askQuestion' ||
                                        toolName === 'ask_question') &&
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
                <box flexDirection="row" gap={1}>
                    <text>
                        <em fg={getModeColor(mode, colors)}>◉</em>
                        <em>{mode === Mode.PLAN ? ' Plan' : ' Build'}</em>
                    </text>
                    <text attributes={TextAttributes.DIM} fg={colors.muted}>
                        {getModelName(model)}
                        {durationMs != null ? ` · ${prettyMs(durationMs)}` : ''}
                    </text>
                </box>
            </box>
        </box>
    );
});
