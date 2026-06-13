import { useState, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { executeLocalTool } from '@/lib/local-tools';
import { useDialog } from '@/providers/dialog';
import { useTheme } from '@/providers/theme';
import { TextAttributes, InputRenderable } from '@opentui/core';

interface ChangeEntry {
    file: string;
    replacements: number;
    lines: number[];
}

export function RenameDialogContent() {
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const { close: closeDialog } = useDialog();
    const [oldName, setOldName] = useState('');
    const [newName, setNewName] = useState('');
    const [globPattern, setGlobPattern] = useState('**/*.{ts,tsx,js,jsx}');
    const [result, setResult] = useState<{
        filesChanged: number;
        totalMatches: number;
        dryRun: boolean;
        changes: ChangeEntry[];
        diff: string;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const oldNameRef = useRef<InputRenderable>(null);
    const newNameRef = useRef<InputRenderable>(null);
    const globPatternRef = useRef<InputRenderable>(null);
    const [focusedIndex, setFocusedIndex] = useState(0);

    const canSubmit =
        !loading && oldName.trim() !== '' && newName.trim() !== '';

    useKeyboard((key) => {
        if (!isTopLayer('dialog')) return;

        if (key.name === 'tab' || key.name === 'down') {
            key.preventDefault();
            setFocusedIndex((prev) => (prev + 1) % 3);
        } else if (key.name === 'up') {
            key.preventDefault();
            setFocusedIndex((prev) => (prev - 1 + 3) % 3);
        } else if (key.name === 'escape') {
            key.preventDefault();
            closeDialog();
        } else if (key.name === 'return' && key.ctrl) {
            key.preventDefault();
            if (canSubmit) void handleRename(true);
        }
    });

    const handleRename = async (apply: boolean) => {
        if (!oldName.trim() || !newName.trim()) {
            setError('Both names are required.');
            return;
        }
        setLoading(true);
        setError(null);

        try {
            const output = await executeLocalTool(
                'renameSymbol',
                {
                    oldName: oldName.trim(),
                    newName: newName.trim(),
                    glob: globPattern,
                    dryRun: !apply,
                },
                'BUILD',
            );
            const data = output as {
                filesChanged: number;
                totalMatches: number;
                dryRun: boolean;
                changes: ChangeEntry[];
                diff: string;
            };
            setResult(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Rename failed');
        } finally {
            setLoading(false);
        }
    };

    if (result && !result.dryRun) {
        return (
            <box flexDirection="column" gap={1}>
                <text fg={colors.success} attributes={TextAttributes.BOLD}>
                    ✓ Renamed {result.totalMatches} occurrence(s) across{' '}
                    {result.filesChanged} file(s)
                </text>
                <scrollbox height={8}>
                    {result.changes.map((c) => (
                        <text key={c.file} fg={colors.text}>
                            {c.file}: {c.replacements} replacement(s) at lines{' '}
                            {c.lines.join(', ')}
                        </text>
                    ))}
                </scrollbox>
            </box>
        );
    }

    return (
        <box flexDirection="column" gap={1} width="100%">
            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                    Old name:
                </text>
                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.dimSeparator}
                    paddingX={1}
                >
                    <input
                        ref={oldNameRef}
                        placeholder="e.g. myFunction"
                        focused={focusedIndex === 0}
                        onContentChange={() => setOldName(oldNameRef.current?.value ?? '')}
                    />
                </box>
            </box>

            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                    New name:
                </text>
                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.dimSeparator}
                    paddingX={1}
                >
                    <input
                        ref={newNameRef}
                        placeholder="e.g. renamedFunction"
                        focused={focusedIndex === 1}
                        onContentChange={() => setNewName(newNameRef.current?.value ?? '')}
                    />
                </box>
            </box>

            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                    Glob pattern:
                </text>
                <box
                    border={['bottom', 'left', 'right', 'top']}
                    borderColor={colors.dimSeparator}
                    paddingX={1}
                >
                    <input
                        ref={globPatternRef}
                        focused={focusedIndex === 2}
                        value={globPattern}
                        onContentChange={() => setGlobPattern(globPatternRef.current?.value ?? '')}
                    />
                </box>
            </box>

            <box flexDirection="row" gap={2} marginTop={1}>
                <text
                    fg={canSubmit ? colors.primary : colors.dimSeparator}
                    onMouseDown={() => {
                        if (canSubmit) handleRename(false);
                    }}
                >
                    {loading ? '[Running...]' : '[🔍 Preview (dry run)]'}
                </text>
                <text
                    fg={canSubmit ? colors.error : colors.dimSeparator}
                    onMouseDown={() => {
                        if (canSubmit) handleRename(true);
                    }}
                >
                    {loading ? '[Running...]' : '[✏️ Apply Rename]'}
                </text>
            </box>

            {error && (
                <text fg={colors.error} marginTop={1}>
                    {error}
                </text>
            )}

            {result && result.dryRun && (
                <box flexDirection="column" gap={0} marginTop={1}>
                    {result.filesChanged === 0 ? (
                        <text fg={colors.dimSeparator}>
                            No occurrences of "{oldName}" found.
                        </text>
                    ) : (
                        <box flexDirection="column" gap={0}>
                            <text
                                fg={colors.success}
                                attributes={TextAttributes.BOLD}
                                marginBottom={1}
                            >
                                📋 Preview: {result.totalMatches} occurrence(s)
                                in {result.filesChanged} file(s)
                            </text>
                            <scrollbox height={6}>
                                {result.changes.map((c) => (
                                    <box key={c.file}>
                                        <text fg={colors.primary}>
                                            {c.file}
                                        </text>
                                        {' — '}
                                        {c.replacements}
                                        {' at lines '}
                                        <text fg={colors.primary}>
                                            {c.lines.join(', ')}
                                        </text>
                                    </box>
                                ))}
                            </scrollbox>
                            <text fg={colors.dimSeparator} marginTop={1}>
                                Click "Apply Rename" to execute changes.
                            </text>
                        </box>
                    )}
                    {result.diff && (
                        <box flexDirection="column" gap={0} marginTop={1}>
                            <text
                                attributes={TextAttributes.BOLD}
                                fg={colors.primary}
                            >
                                Diff:
                            </text>
                            <scrollbox height={8}>
                                <text fg={colors.text}>{result.diff}</text>
                            </scrollbox>
                        </box>
                    )}
                </box>
            )}
        </box>
    );
}
