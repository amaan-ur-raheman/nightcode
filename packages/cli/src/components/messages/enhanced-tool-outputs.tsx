import React, { useState } from 'react';
import path from 'path';
import { type ThemeColors } from '@/theme';
import { highlightCode } from '@/lib/syntax-highlight';

// ==========================================
// 1. Search Matches Block (grep / codeSearch)
// ==========================================

interface Match {
    file: string;
    line: number;
    content: string;
}

export function SearchMatchesBlock({
    matches,
    colors,
}: {
    matches: Match[];
    colors: ThemeColors;
}) {
    if (!matches || matches.length === 0) return null;

    const fileGroups: Record<string, Match[]> = {};
    for (const match of matches) {
        if (!fileGroups[match.file]) {
            fileGroups[match.file] = [];
        }
        fileGroups[match.file]!.push(match);
    }

    return (
        <box paddingLeft={2} width="100%" flexDirection="column">
            {Object.entries(fileGroups).map(([file, fileMatches], fileIdx) => {
                return (
                    <box key={`file-${fileIdx}`} flexDirection="column" marginBottom={1} width="100%">
                        <text fg={colors.primary}>
                            [{path.relative(process.cwd(), file) || file}](file://{path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)})
                        </text>
                        {fileMatches.map((m, mIdx) => (
                            <box key={`match-${mIdx}`} paddingLeft={2} flexDirection="row" width="100%">
                                <text fg={colors.dimSeparator}>Line {m.line}: </text>
                                {highlightCode(m.content, file.split('.').pop() || '', colors, true)}
                            </box>
                        ))}
                    </box>
                );
            })}
        </box>
    );
}

// ==========================================
// 2. Git Status Block (gitStatus / gitStatusExtended)
// ==========================================

export function parseGitShortStatus(statusStr: string) {
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    let currentBranch = '';

    for (const line of statusStr.split('\n')) {
        if (!line.trim()) continue;
        if (line.startsWith('## ')) {
            currentBranch = line.slice(3).split('...')[0]?.trim() || '';
            continue;
        }
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.substring(3).trim();

        if (indexStatus === '?' && workTreeStatus === '?') {
            untracked.push(filePath);
        } else {
            if (indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== undefined) {
                staged.push(filePath);
            }
            if (workTreeStatus !== ' ' && workTreeStatus !== '?' && workTreeStatus !== undefined) {
                unstaged.push(filePath);
            }
        }
    }
    return { staged, unstaged, untracked, currentBranch };
}

export function GitStatusBlock({
    staged,
    unstaged,
    untracked,
    currentBranch,
    colors,
}: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
    currentBranch?: string;
    colors: ThemeColors;
}) {
    const hasStaged = staged && staged.length > 0;
    const hasUnstaged = unstaged && unstaged.length > 0;
    const hasUntracked = untracked && untracked.length > 0;

    return (
        <box paddingLeft={2} flexDirection="column" width="100%">
            {currentBranch && (
                <text fg={colors.info}>
                    On branch: <span fg={colors.primary}>{currentBranch}</span>
                </text>
            )}
            {hasStaged && (
                <box flexDirection="column" marginTop={1} width="100%">
                    <text fg={colors.success} attributes={['bold'] as any}>
                        Staged Changes:
                    </text>
                    {staged.map((file, idx) => (
                        <text key={`staged-${idx}`} paddingLeft={2} fg={colors.success}>
                            ✓ [{file}](file://{path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)})
                        </text>
                    ))}
                </box>
            )}
            {hasUnstaged && (
                <box flexDirection="column" marginTop={1} width="100%">
                    <text fg={colors.error} attributes={['bold'] as any}>
                        Unstaged Changes:
                    </text>
                    {unstaged.map((file, idx) => (
                        <text key={`unstaged-${idx}`} paddingLeft={2} fg={colors.error}>
                            ✗ [{file}](file://{path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)})
                        </text>
                    ))}
                </box>
            )}
            {hasUntracked && (
                <box flexDirection="column" marginTop={1} width="100%">
                    <text fg={colors.planMode} attributes={['bold'] as any}>
                        Untracked Files:
                    </text>
                    {untracked.map((file, idx) => (
                        <text key={`untracked-${idx}`} paddingLeft={2} fg={colors.planMode}>
                            ? [{file}](file://{path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)})
                        </text>
                    ))}
                </box>
            )}
            {!hasStaged && !hasUnstaged && !hasUntracked && (
                <text fg={colors.dimSeparator} marginTop={1}>
                    Nothing to commit, working tree clean
                </text>
            )}
        </box>
    );
}

// ==========================================
// 3. Secret Scan Block (secretScan)
// ==========================================

interface SecretMatch {
    file: string;
    line: number;
    type: string;
    snippet: string;
    severity: 'high' | 'medium' | 'low';
}

export function SecretScanBlock({
    secrets,
    colors,
}: {
    secrets: SecretMatch[];
    colors: ThemeColors;
}) {
    if (!secrets || secrets.length === 0) return null;

    return (
        <box paddingLeft={2} flexDirection="column" width="100%">
            <box
                border={['top', 'bottom', 'left', 'right']}
                borderColor={colors.error}
                flexDirection="column"
                paddingX={2}
                paddingY={1}
                width="100%"
            >
                <text fg={colors.error} attributes={['bold'] as any}>
                    🛡️ Security Scan: {secrets.length} secret{secrets.length > 1 ? 's' : ''} found
                </text>
                <text fg={colors.dimSeparator} marginBottom={1}>
                    Review each finding before staging or committing changes.
                </text>
                {secrets.map((m, idx) => {
                    const sevColor =
                        m.severity === 'high'
                            ? colors.error
                            : m.severity === 'medium'
                              ? colors.planMode
                              : colors.info;
                    return (
                        <box key={`secret-${idx}`} flexDirection="column" marginBottom={idx === secrets.length - 1 ? 0 : 1} width="100%">
                            <box flexDirection="row" gap={1} width="100%">
                                <text fg={sevColor} attributes={['bold'] as any}>
                                    [{m.severity.toUpperCase()}]
                                </text>
                                <text fg={colors.text}>
                                    [{m.file}:{m.line}](file://{path.isAbsolute(m.file) ? m.file : path.resolve(process.cwd(), m.file)}#L{m.line})
                                </text>
                                <text fg={colors.dimSeparator}>({m.type})</text>
                            </box>
                            <text paddingLeft={2} fg={colors.dimSeparator}>
                                Snippet: <span fg={colors.text}>{m.snippet}</span>
                            </text>
                        </box>
                    );
                })}
            </box>
        </box>
    );
}

// ==========================================
// 4. Profile Code Block (profileCode)
// ==========================================

interface Benchmark {
    name: string;
    opsPerSec: number;
    avgTimeNs: number;
    margin: string;
    rank: number;
}

export function ProfileCodeBlock({
    summary,
    hotspots,
    topPerformers,
    durationMs,
    colors,
}: {
    summary: string;
    hotspots: Benchmark[];
    topPerformers: Benchmark[];
    durationMs: number;
    colors: ThemeColors;
}) {
    const allItems = topPerformers && topPerformers.length > 0 ? topPerformers : hotspots;
    if (!allItems || allItems.length === 0) return null;

    const maxOps = Math.max(...allItems.map((i) => i.opsPerSec || 1));

    return (
        <box paddingLeft={2} flexDirection="column" width="100%">
            <text fg={colors.info} attributes={['bold'] as any}>
                ⏱️ Profiling Results ({durationMs}ms)
            </text>
            <text fg={colors.dimSeparator} marginBottom={1}>
                {summary}
            </text>
            <box flexDirection="column" width="100%">
                {allItems.slice(0, 5).map((item, idx) => {
                    const ratio = item.opsPerSec / maxOps;
                    const barLength = Math.max(1, Math.round(ratio * 10));
                    const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
                    const displayName = item.name.length > 18 ? item.name.slice(0, 15) + '...' : item.name;
                    return (
                        <box key={`perf-${idx}`} flexDirection="row" gap={2} width="100%">
                            <text fg={colors.text}>
                                {displayName.padEnd(20)}
                            </text>
                            <text fg={colors.primary}>
                                {Math.round(item.opsPerSec).toLocaleString().padStart(12)} ops/s
                            </text>
                            <text fg={colors.dimSeparator}>
                                [{bar}] {Math.round(item.avgTimeNs / 1000).toLocaleString()} µs
                            </text>
                        </box>
                    );
                })}
            </box>
        </box>
    );
}

// ==========================================
// 5. Git Log Timeline Block (gitLog)
// ==========================================

interface Commit {
    hash: string;
    message: string;
    author?: string;
    date?: string;
}

export function GitLogTimelineBlock({
    commits,
    colors,
}: {
    commits: Commit[];
    colors: ThemeColors;
}) {
    if (!commits || commits.length === 0) return null;

    return (
        <box paddingLeft={2} flexDirection="column" width="100%">
            {commits.map((commit, idx) => {
                const isLast = idx === commits.length - 1;
                return (
                    <box key={`commit-${idx}`} flexDirection="column" width="100%">
                        <box flexDirection="row" gap={1} width="100%">
                            <text fg={colors.dimSeparator}>
                                {idx === 0 ? '┯' : '┠'}
                            </text>
                            <text fg={colors.primary}>
                                {commit.hash.slice(0, 7)}
                            </text>
                            <text fg={colors.text}>
                                - {commit.message}
                            </text>
                        </box>
                        {commit.author && (
                            <box flexDirection="row" gap={1} width="100%">
                                <text fg={colors.dimSeparator}>
                                    {isLast ? ' ' : '┃'}
                                </text>
                                <text fg={colors.dimSeparator}>
                                    Author: {commit.author} ({commit.date})
                                </text>
                            </box>
                        )}
                        {!isLast && (
                            <box flexDirection="row" width="100%">
                                <text fg={colors.dimSeparator}>┃</text>
                            </box>
                        )}
                    </box>
                );
            })}
        </box>
    );
}
