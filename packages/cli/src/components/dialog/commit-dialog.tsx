import React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useDialog } from '@/providers/dialog';
import { useTheme } from '@/providers/theme';
import { useToast } from '@/providers/toast';
import { useKeyboard } from '@opentui/react';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { TextAttributes, InputRenderable } from '@opentui/core';
import { apiClient } from '@/lib/api-client';
import { runGit } from '@/lib/tools/utils';
import { resolveProviderForModel } from '@nightcode/shared';
import { getApiKeyForProvider } from '@/lib/api-keys';

interface CommitDialogContentProps {
    sessionId: string;
    model: string;
    onSuccess?: () => void;
}

export function CommitDialogContent({
    sessionId,
    model,
    onSuccess,
}: CommitDialogContentProps) {
    const { colors } = useTheme();
    const { close } = useDialog();
    const toast = useToast();
    const { isTopLayer } = useKeyboardLayer();
    const inputRef = useRef<InputRenderable>(null);
    const [commitMessage, setCommitMessage] = useState('');
    const [stagedFiles, setStagedFiles] = useState<string[]>([]);
    const [loadingFiles, setLoadingFiles] = useState(true);
    const [generatingMessage, setGeneratingMessage] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch staged files on load
    const fetchStagedFiles = async (signal?: { aborted: boolean }) => {
        setLoadingFiles(true);
        try {
            const statusResult = await runGit(process.cwd(), [
                'status',
                '--porcelain',
            ]);
            if (signal?.aborted) return;
            if (statusResult.exitCode === 0) {
                const files: string[] = [];
                for (const line of statusResult.stdout.split('\n')) {
                    if (!line || line.length < 3) continue;
                    const x = line[0];
                    if (x !== ' ' && x !== '?') {
                        files.push(line.slice(3));
                    }
                }
                setStagedFiles(files);
            } else {
                setError(statusResult.stderr || 'Failed to check git status');
            }
        } catch (err) {
            if (signal?.aborted) return;
            setError('Failed to fetch staged files');
        } finally {
            if (!signal?.aborted) setLoadingFiles(false);
        }
    };

    useEffect(() => {
        const signal = { aborted: false };
        fetchStagedFiles(signal);
        return () => {
            signal.aborted = true;
        };
    }, []);

    // Generate AI commit message
    const handleGenerateMessage = async () => {
        if (stagedFiles.length === 0) {
            setError('No files staged for commit.');
            return;
        }
        setGeneratingMessage(true);
        setError(null);
        try {
            // Get diff of staged files
            const diffResult = await runGit(process.cwd(), [
                'diff',
                '--cached',
            ]);
            if (diffResult.exitCode !== 0) {
                throw new Error(diffResult.stderr || 'Failed to get git diff');
            }
            if (!diffResult.stdout) {
                throw new Error('No staged changes found to analyze.');
            }

            let providerKey: string | null = null;
            try {
                const provider = resolveProviderForModel(model);
                providerKey = await getApiKeyForProvider(provider);
            } catch {
                // ignore
            }

            const headers: Record<string, string> = {};
            if (providerKey) {
                headers['x-provider-key'] = providerKey;
            }

            const res = await apiClient.sessions[':id']['commit-message'].$post(
                {
                    param: { id: sessionId },
                    json: {
                        diff: diffResult.stdout,
                        model: model,
                    },
                },
                {
                    headers,
                },
            );

            if (!res.ok) {
                const data = (await res.json()) as { error?: string };
                throw new Error(
                    data.error || 'Failed to generate commit message',
                );
            }

            const data = (await res.json()) as { commitMessage: string };
            if (inputRef.current) {
                inputRef.current.value = data.commitMessage;
            }
            setCommitMessage(data.commitMessage);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Error generating message',
            );
        } finally {
            setGeneratingMessage(false);
        }
    };

    const handleCommit = async () => {
        if (!commitMessage.trim()) {
            setError('Commit message cannot be empty.');
            return;
        }
        if (stagedFiles.length === 0) {
            setError('No files staged for commit.');
            return;
        }
        setCommitting(true);
        setError(null);
        try {
            const result = await runGit(process.cwd(), [
                'commit',
                '-m',
                commitMessage,
            ]);
            if (result.exitCode === 0) {
                toast.show({
                    variant: 'success',
                    message: 'Changes committed successfully!',
                });
                close();
                onSuccess?.();
            } else {
                throw new Error(
                    result.stderr || result.stdout || 'Git commit failed',
                );
            }
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Error committing changes',
            );
        } finally {
            setCommitting(false);
        }
    };

    const keyHandlerRef = useRef<((key: any) => void) | undefined>(undefined);
    keyHandlerRef.current = (key) => {
        if (!isTopLayer('dialog')) return;

        if (key.name === 'return' && key.ctrl) {
            key.preventDefault();
            void handleCommit();
        }
    };

    useKeyboard((key) => {
        keyHandlerRef.current?.(key);
    });

    const canSubmit =
        !committing &&
        !generatingMessage &&
        commitMessage.trim() !== '' &&
        stagedFiles.length > 0;

    return (
        <box flexDirection="column" gap={1} width="100%">
            {loadingFiles ? (
                <text fg={colors.dimSeparator}>Loading staged files...</text>
            ) : stagedFiles.length === 0 ? (
                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.error}
                    paddingX={2}
                    paddingY={1}
                    flexDirection="column"
                    gap={1}
                >
                    <text fg={colors.error} attributes={TextAttributes.BOLD}>
                        [WARNING] No Changes Staged for Commit
                    </text>
                    <text fg={colors.text}>
                        Use Space in the file tree view or run 'git add' in bash
                        to stage changes.
                    </text>
                </box>
            ) : (
                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.success}
                    paddingX={2}
                    paddingY={1}
                    flexDirection="column"
                    gap={1}
                    width="100%"
                >
                    <text fg={colors.success} attributes={TextAttributes.BOLD}>
                        Staged Changes ({stagedFiles.length})
                    </text>
                    <scrollbox height={4}>
                        {stagedFiles.map((file) => (
                            <text key={file} fg={colors.text}>
                                {`  ✔ ${file}`}
                            </text>
                        ))}
                    </scrollbox>
                </box>
            )}

            <box flexDirection="column" gap={0} marginTop={1} width="100%">
                <text
                    attributes={TextAttributes.BOLD}
                    fg={colors.primary}
                    marginBottom={1}
                >
                    Commit Message:
                </text>
                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.primary}
                    paddingX={1}
                >
                    <input
                        ref={inputRef}
                        placeholder="Enter commit message..."
                        focused
                        onContentChange={() => {
                            setCommitMessage(inputRef.current?.value ?? '');
                        }}
                    />
                </box>
            </box>

            {error && (
                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.error}
                    paddingX={2}
                    paddingY={0}
                    marginTop={1}
                >
                    <text fg={colors.error}>[ERROR] {error}</text>
                </box>
            )}

            <box flexDirection="row" gap={2} marginTop={1}>
                {stagedFiles.length > 0 && (
                    <box
                        paddingX={2}
                        backgroundColor={
                            generatingMessage ? undefined : colors.primary
                        }
                        onMouseDown={() => {
                            if (!generatingMessage)
                                void handleGenerateMessage();
                        }}
                    >
                        <text
                            fg={
                                generatingMessage
                                    ? colors.dimSeparator
                                    : 'black'
                            }
                            attributes={TextAttributes.BOLD}
                        >
                            {generatingMessage
                                ? 'Generating...'
                                : 'AI Generate'}
                        </text>
                    </box>
                )}
                <box
                    paddingX={2}
                    backgroundColor={canSubmit ? colors.success : undefined}
                    onMouseDown={() => {
                        if (canSubmit) void handleCommit();
                    }}
                >
                    <text
                        fg={canSubmit ? 'black' : colors.dimSeparator}
                        attributes={TextAttributes.BOLD}
                    >
                        {committing ? 'Committing...' : 'Commit (Ctrl+Enter)'}
                    </text>
                </box>
            </box>
            <text
                attributes={TextAttributes.DIM}
                fg={colors.dimSeparator}
                marginTop={1}
            >
                Press Esc to cancel
            </text>
        </box>
    );
}
