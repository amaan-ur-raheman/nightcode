import { useState, useEffect, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';
import { readFile } from 'fs/promises';
import { basename } from 'path';

import { useTheme } from '@/providers/theme';
import { useFileTree } from '@/providers/file-tree';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { EmptyBorder } from '@/components/border';

interface CodePanelProps {
    filePath: string;
    highlightedLine?: number;
}

export function CodePanel({ filePath, highlightedLine }: CodePanelProps) {
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const { activePane, setActivePane, clearSelectedFile } = useFileTree();
    const [lines, setLines] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<any>(null);

    const fileName = basename(filePath);

    // Fetch file contents when filePath changes
    useEffect(() => {
        let ignore = false;
        async function fetchFile() {
            setLoading(true);
            setError(null);
            try {
                const text = await readFile(filePath, 'utf-8');
                if (ignore) return;
                setLines(text.split('\n'));
            } catch (err) {
                if (ignore) return;
                setError(
                    err instanceof Error ? err.message : 'Failed to read file',
                );
                setLines([]);
            } finally {
                if (!ignore) setLoading(false);
            }
        }
        void fetchFile();
        return () => {
            ignore = true;
        };
    }, [filePath]);

    // Scroll to highlighted line when it changes
    useEffect(() => {
        if (
            highlightedLine !== undefined &&
            scrollRef.current &&
            lines.length > 0
        ) {
            // Scroll so the highlighted line is centered or near the top
            const targetScroll = Math.max(0, highlightedLine - 5);
            scrollRef.current.scrollTo(targetScroll);
        }
    }, [highlightedLine, lines.length]);

    // Keyboard navigation
    useKeyboard((key) => {
        if (!isTopLayer('base')) return;

        if (key.name === 'escape') {
            key.preventDefault();
            clearSelectedFile();
            return;
        }

        if (activePane !== 'code-panel') return;

        const sb = scrollRef.current;
        if (!sb) return;

        if (key.name === 'up' || key.name === 'k') {
            key.preventDefault();
            sb.scrollTo(Math.max(0, sb.scrollTop - 1));
        } else if (key.name === 'down' || key.name === 'j') {
            key.preventDefault();
            const maxScroll = Math.max(0, lines.length - sb.viewport.height);
            sb.scrollTo(Math.min(maxScroll, sb.scrollTop + 1));
        } else if (key.name === 'pageup') {
            key.preventDefault();
            sb.scrollTo(Math.max(0, sb.scrollTop - sb.viewport.height));
        } else if (key.name === 'pagedown') {
            key.preventDefault();
            const maxScroll = Math.max(0, lines.length - sb.viewport.height);
            sb.scrollTo(Math.min(maxScroll, sb.scrollTop + sb.viewport.height));
        } else if (key.name === 'left' || key.name === 'h') {
            key.preventDefault();
            setActivePane('symbol-outline');
        }
    });

    const isActive = activePane === 'code-panel';

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
                <text fg={isActive ? colors.primary : colors.dimSeparator}>
                    {isActive ? '● ' : ''}
                    <em fg={isActive ? colors.primary : colors.info}>File: </em>
                    <em fg={isActive ? colors.text : colors.dimSeparator}>{fileName}</em>
                    <em fg={colors.dimSeparator}> ({filePath})</em>
                </text>
            </box>

            {/* Body */}
            <box flexGrow={1} paddingX={1} overflow="hidden">
                {loading && (
                    <text fg={colors.dimSeparator}>Loading file...</text>
                )}
                {error && <text fg={colors.error}>{error}</text>}
                {!loading && !error && lines.length > 0 && (
                    <scrollbox ref={scrollRef} flexGrow={1}>
                        {lines.map((lineContent, index) => {
                            const lineNum = index + 1;
                            const isHighlighted = highlightedLine === lineNum;

                            let bg = undefined;
                            let fg = colors.text;

                            if (isHighlighted) {
                                bg = colors.selection;
                                fg = 'black';
                            }

                            // Format line number with padding
                            const lineNumStr =
                                String(lineNum).padStart(4) + ' ';

                            return (
                                <box
                                    key={`line-${lineNum}`}
                                    flexDirection="row"
                                    backgroundColor={bg}
                                    width="100%"
                                >
                                    <text
                                        fg={
                                            isHighlighted
                                                ? 'black'
                                                : colors.dimSeparator
                                        }
                                        selectable={false}
                                    >
                                        {lineNumStr}
                                    </text>
                                    <text fg={fg}>{lineContent}</text>
                                </box>
                            );
                        })}
                    </scrollbox>
                )}
            </box>

            {/* Footer */}
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
                    {isActive
                        ? 'Esc to close • Left arrow to outline • Up/Down to scroll'
                        : 'Esc to close • click code or press Right from outline to focus'}
                </text>
            </box>
        </box>
    );
}
