import { basename } from 'path';
import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { useGitDiff } from '@/hooks/use-git-diff';
import { useFileTree } from '@/providers/file-tree';
import { EmptyBorder } from '@/components/border';

type FileDiffPanelProps = {
    filePath: string;
};

export function FileDiffPanel({ filePath }: FileDiffPanelProps) {
    const { colors } = useTheme();
    const { clearSelectedFile } = useFileTree();
    const { diffText, loading, error } = useGitDiff(filePath);
    const fileName = basename(filePath);

    useKeyboard((key) => {
        if (key.name === 'escape') {
            key.preventDefault();
            clearSelectedFile();
        }
    });

    return (
        <box flexDirection="column" flexGrow={1} height="100%">
            {/* Header */}
            <box
                border={['bottom']}
                borderColor={colors.dimSeparator}
                customBorderChars={{
                    ...EmptyBorder,
                    horizontal: '─',
                }}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={0}
                paddingBottom={0}
            >
                <text>
                    <em fg={colors.info}>Diff: </em>
                    <em fg={colors.text}>{fileName}</em>
                    <em fg={colors.dimSeparator}> ({filePath})</em>
                </text>
            </box>

            {/* Body */}
            <box flexGrow={1} paddingX={1} overflow="hidden">
                {loading && (
                    <text fg={colors.dimSeparator}>Loading diff...</text>
                )}
                {error && <text fg={colors.error}>{error}</text>}
                {!loading && !error && !!diffText && (
                    <diff
                        view="split"
                        diff={diffText}
                        showLineNumbers
                        filetype={filePath.split('.').pop()?.toLowerCase()}
                    />
                )}
                {!loading && !error && !diffText && (
                    <text fg={colors.dimSeparator}>No uncommitted changes</text>
                )}
            </box>

            {/* Footer hint bar */}
            <box
                border={['top']}
                borderColor={colors.dimSeparator}
                customBorderChars={{
                    ...EmptyBorder,
                    horizontal: '─',
                }}
                paddingLeft={2}
                paddingRight={2}
            >
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    Esc to close • ↑↓ to scroll
                </text>
            </box>
        </box>
    );
}
