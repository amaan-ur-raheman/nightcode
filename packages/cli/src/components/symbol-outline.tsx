import { useState, useEffect, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { useFileTree } from '@/providers/file-tree';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { getOutlineTool } from '@/lib/tools/get-outline';

interface SymbolItem {
    name: string;
    kind: string;
    line: number;
}

interface SymbolOutlineProps {
    filePath: string;
    onSelectSymbol?: (symbol: SymbolItem) => void;
    width?: number;
}

export function SymbolOutline({
    filePath,
    onSelectSymbol,
    width = 30,
}: SymbolOutlineProps) {
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const { activePane, setActivePane } = useFileTree();
    const [symbols, setSymbols] = useState<SymbolItem[]>([]);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<any>(null);

    // Fetch outline when filePath changes
    useEffect(() => {
        let ignore = false;
        async function fetchOutline() {
            setLoading(true);
            try {
                const result = await getOutlineTool({ path: filePath });
                if (ignore) return;
                setSymbols(result.symbols || []);
                setFocusedIndex(0);
            } catch (err) {
                if (ignore) return;
                setSymbols([]);
            } finally {
                if (!ignore) setLoading(false);
            }
        }
        void fetchOutline();
        return () => {
            ignore = true;
        };
    }, [filePath]);

    // Keyboard navigation
    useKeyboard((key) => {
        if (!isTopLayer('base')) return;
        if (activePane !== 'symbol-outline') return;

        if (symbols.length === 0) {
            if (key.name === 'left' || key.name === 'h') {
                key.preventDefault();
                setActivePane('file-tree');
            }
            return;
        }

        if (key.name === 'up' || key.name === 'k') {
            key.preventDefault();
            setFocusedIndex((prev) => {
                const next = Math.max(0, prev - 1);
                onSelectSymbol?.(symbols[next]!);
                // Scroll outline list box if needed
                const sb = scrollRef.current;
                if (sb && next < sb.scrollTop) {
                    sb.scrollTo(next);
                }
                return next;
            });
        } else if (key.name === 'down' || key.name === 'j') {
            key.preventDefault();
            setFocusedIndex((prev) => {
                const next = Math.min(symbols.length - 1, prev + 1);
                onSelectSymbol?.(symbols[next]!);
                // Scroll outline list box if needed
                const sb = scrollRef.current;
                if (sb) {
                    const visibleEnd = sb.scrollTop + sb.viewport.height - 1;
                    if (next > visibleEnd) {
                        sb.scrollTo(next - sb.viewport.height + 1);
                    }
                }
                return next;
            });
        } else if (key.name === 'left' || key.name === 'h') {
            key.preventDefault();
            setActivePane('file-tree');
        } else if (
            key.name === 'right' ||
            key.name === 'l' ||
            key.name === 'return'
        ) {
            key.preventDefault();
            if (symbols[focusedIndex]) {
                onSelectSymbol?.(symbols[focusedIndex]!);
            }
            setActivePane('code-panel');
        }
    });

    const getSymbolIcon = (kind: string): string => {
        switch (kind) {
            case 'class':
                return 'C ';
            case 'interface':
                return 'I ';
            case 'type':
                return 'T ';
            case 'function':
            case 'arrow':
            case 'def':
            case 'func':
            case 'fn':
                return 'F ';
            case 'enum':
                return 'E ';
            default:
                return 'V ';
        }
    };

    const isActive = activePane === 'symbol-outline';
    const visibleHeight = Math.max(5, symbols.length);

    return (
        <box
            flexDirection="column"
            width={width}
            height="100%"
            border={['right']}
            borderColor={colors.dimSeparator}
            paddingLeft={1}
            paddingTop={1}
            overflow="hidden"
        >
            <text
                attributes={TextAttributes.BOLD}
                fg={
                    activePane === 'symbol-outline'
                        ? colors.primary
                        : colors.dimSeparator
                }
            >
                {activePane === 'symbol-outline' ? '● ' : ''}
                Outline
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                {isActive
                    ? 'j/k nav • l/Enter code • h tree'
                    : 'inactive outline'}
            </text>

            <box flexDirection="column" paddingTop={1} flexGrow={1}>
                {loading && (
                    <text fg={colors.dimSeparator} paddingLeft={1}>
                        Parsing outline...
                    </text>
                )}
                {!loading && symbols.length === 0 && (
                    <text fg={colors.dimSeparator} paddingLeft={1}>
                        No symbols found
                    </text>
                )}
                {!loading && symbols.length > 0 && (
                    <scrollbox ref={scrollRef} flexGrow={1}>
                        {symbols.map((sym, i) => {
                            const isFocused = i === focusedIndex;
                            let fg = colors.text;
                            if (isFocused) {
                                fg = isActive
                                    ? colors.selection
                                    : colors.dimSeparator;
                            }
                            const focusMarker = isFocused
                                ? isActive
                                    ? '▸ '
                                    : '◦ '
                                : '  ';

                            return (
                                <text
                                    key={`${sym.name}-${sym.line}-${i}`}
                                    fg={fg}
                                    wrapMode="none"
                                    onMouseDown={() => {
                                        setFocusedIndex(i);
                                        onSelectSymbol?.(sym);
                                        setActivePane('symbol-outline');
                                    }}
                                >
                                    {focusMarker}
                                    <em fg={colors.info}>
                                        {getSymbolIcon(sym.kind)}
                                    </em>
                                    {sym.name}
                                    <em fg={colors.dimSeparator}>
                                        {' '}
                                        ({sym.line})
                                    </em>
                                </text>
                            );
                        })}
                    </scrollbox>
                )}
            </box>
        </box>
    );
}
