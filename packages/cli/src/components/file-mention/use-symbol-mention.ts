import {
    useState,
    useEffect,
    useRef,
    useCallback,
    type RefObject,
} from 'react';
import { useKeyboard } from '@opentui/react';
import type { TextareaRenderable, ScrollBoxRenderable } from '@opentui/core';
import { basename } from 'path';

import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { getOutlineTool } from '@/lib/tools/get-outline';
import {
    findActiveMention,
    findMentionTokenBefore,
    type MentionMatch,
} from './use-file-mention';
import { extractSymbolBlock } from './extract-symbol-block';

export interface SymbolCandidate {
    name: string;
    kind: string;
    line: number;
}

type UseSymbolMentionReturn = {
    showSymbolMenu: boolean;
    candidates: SymbolCandidate[];
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    setSelectedIndex: (index: number) => void;
    sync: (text: string, cursorOffset: number) => void;
    execute: (index: number) => void;
    handleBackspace: () => boolean;
    close: () => void;
};

export function useSymbolMention(
    textareaRef: RefObject<TextareaRenderable | null>,
    selectedFile: string | undefined,
): UseSymbolMentionReturn {
    const activeMentionRef = useRef<MentionMatch | null>(null);
    const scrollRef = useRef<ScrollBoxRenderable>(null);

    const [activeMention, setActiveMention] = useState<MentionMatch | null>(
        null,
    );
    const [allSymbols, setAllSymbols] = useState<SymbolCandidate[]>([]);
    const [candidates, setCandidates] = useState<SymbolCandidate[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const candidatesRef = useRef(candidates);
    candidatesRef.current = candidates;
    const selectedIndexRef = useRef(selectedIndex);
    selectedIndexRef.current = selectedIndex;
    const showSymbolMenuRef = useRef(false);

    const { push, pop, isTopLayer } = useKeyboardLayer();

    const showSymbolMenu = activeMention !== null && selectedFile !== undefined;
    showSymbolMenuRef.current = showSymbolMenu;

    const close = useCallback(() => {
        activeMentionRef.current = null;
        setActiveMention(null);
        setCandidates([]);
        pop('symbol-mention');
    }, [pop]);

    // Fetch all symbols for the selected file when it changes
    useEffect(() => {
        if (!selectedFile) {
            setAllSymbols([]);
            return;
        }
        let ignore = false;
        async function fetchSymbols() {
            try {
                const result = await getOutlineTool({ path: selectedFile });
                if (!ignore) {
                    setAllSymbols(result.symbols || []);
                }
            } catch {
                if (!ignore) setAllSymbols([]);
            }
        }
        void fetchSymbols();
        return () => {
            ignore = true;
        };
    }, [selectedFile]);

    const sync = useCallback(
        (text: string, cursorOffset: number) => {
            if (!selectedFile) return;

            const nextMention = findActiveMention(text, cursorOffset);
            const previousMention = activeMentionRef.current;
            const mentionChanged =
                previousMention?.start !== nextMention?.start ||
                previousMention?.end !== nextMention?.end ||
                previousMention?.query !== nextMention?.query;

            if (!nextMention) {
                if (previousMention) close();
                return;
            }

            activeMentionRef.current = nextMention;
            setActiveMention(nextMention);

            if (!previousMention) {
                push('symbol-mention', () => {
                    close();
                    return true;
                });
            }

            if (mentionChanged) {
                setSelectedIndex(0);
                scrollRef.current?.scrollTo(0);
            }
        },
        [close, push, selectedFile],
    );

    const execute = useCallback(
        (index: number) => {
            const textarea = textareaRef.current;
            const mention = activeMentionRef.current;
            const candidate = candidatesRef.current[index];
            if (!textarea || !mention || !candidate || !selectedFile) return;

            void (async () => {
                try {
                    const block = await extractSymbolBlock(
                        selectedFile,
                        candidate.line,
                    );
                    const fileBase = basename(selectedFile);
                    const textToInsert = `\n\n\`\`\`\n// Symbol: ${candidate.name} (${fileBase}:${candidate.line})\n${block}\n\`\`\`\n`;

                    // Replace the mention query and append the code block context
                    const beforeMention = textarea.plainText.slice(
                        0,
                        mention.start,
                    );
                    const afterMention = textarea.plainText.slice(mention.end);
                    const newText = beforeMention + textToInsert + afterMention;

                    textarea.replaceText(newText);
                    textarea.cursorOffset =
                        beforeMention.length + textToInsert.length;
                    close();
                } catch {
                    close();
                }
            })();
        },
        [close, selectedFile],
    );

    const handleBackspace = useCallback((): boolean => {
        const textarea = textareaRef.current;
        if (!textarea) return false;
        const token = findMentionTokenBefore(
            textarea.plainText,
            textarea.cursorOffset,
        );
        if (!token) return false;
        const newText =
            textarea.plainText.slice(0, token.start) +
            textarea.plainText.slice(token.end);
        textarea.replaceText(newText);
        textarea.cursorOffset = token.start;
        sync(newText, token.start);
        return true;
    }, [sync]);

    // Filter candidates based on active mention query
    const activeMentionQuery = activeMention?.query ?? null;
    useEffect(() => {
        if (activeMentionQuery === null) {
            setCandidates([]);
            return;
        }

        const queryLower = activeMentionQuery.toLowerCase();
        const filtered = allSymbols.filter((sym) =>
            sym.name.toLowerCase().includes(queryLower),
        );

        setCandidates(filtered);
        setSelectedIndex((i) =>
            filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1),
        );
    }, [activeMentionQuery, allSymbols]);

    // Arrow key navigation
    useKeyboard((key) => {
        if (!showSymbolMenuRef.current || !isTopLayer('symbol-mention')) return;

        if (key.name === 'escape') {
            key.preventDefault();
            close();
        } else if (key.name === 'up') {
            key.preventDefault();
            setSelectedIndex((i) => {
                const next = Math.max(0, i - 1);
                const sb = scrollRef.current;
                if (sb && next < sb.scrollTop) sb.scrollTo(next);
                return next;
            });
        } else if (key.name === 'down') {
            key.preventDefault();
            setSelectedIndex((i) => {
                if (candidatesRef.current.length === 0) return 0;
                const next = Math.min(candidatesRef.current.length - 1, i + 1);
                const sb = scrollRef.current;
                if (sb) {
                    const visibleEnd = sb.scrollTop + sb.viewport.height - 1;
                    if (next > visibleEnd)
                        sb.scrollTo(next - sb.viewport.height + 1);
                }
                return next;
            });
        }
    });

    return {
        showSymbolMenu,
        candidates,
        selectedIndex,
        scrollRef,
        setSelectedIndex,
        sync,
        execute,
        handleBackspace,
        close,
    };
}
