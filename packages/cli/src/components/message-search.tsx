import React, { useState, useEffect, useRef } from 'react';
import { useKeyboard } from '@opentui/react';

import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

type ChatMessage = {
    role: string;
    parts: { type: string; text?: string }[];
};

type MessageSearchProps = {
    messages: ChatMessage[];
    isOpen: boolean;
    onClose: () => void;
    onJumpToMessage: (messageIndex: number) => void;
};

export function MessageSearch({
    messages,
    isOpen,
    onClose,
    onJumpToMessage,
}: MessageSearchProps) {
    const { colors } = useTheme();
    const [searchText, setSearchText] = useState('');
    const [matchIndex, setMatchIndex] = useState(-1);
    const [matches, setMatches] = useState<
        { messageIndex: number; text: string }[]
    >([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputRef = useRef<any>(null);

    // Search through messages only when open and searchText/messages change
    useEffect(() => {
        if (!isOpen) return;

        if (!searchText.trim()) {
            setMatches([]);
            setMatchIndex(-1);
            return;
        }

        const searchLower = searchText.toLowerCase();
        const found: { messageIndex: number; text: string }[] = [];

        messages.forEach((msg, idx) => {
            // Search in text parts
            if (msg.parts) {
                for (const part of msg.parts) {
                    if (part.type === 'text' && typeof part.text === 'string') {
                        if (part.text.toLowerCase().includes(searchLower)) {
                            found.push({ messageIndex: idx, text: part.text });
                        }
                    }
                }
            }
        });

        setMatches(found);
        setMatchIndex(found.length > 0 ? 0 : -1);
    }, [isOpen, searchText, messages]);

    // Reset search when closed
    useEffect(() => {
        if (!isOpen) {
            setSearchText('');
            setMatches([]);
            setMatchIndex(-1);
        }
    }, [isOpen]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    // Handle key navigation and actions
    useKeyboard((key) => {
        if (!isOpen) return;

        if (key.name === 'escape') {
            key.preventDefault();
            onClose();
        } else if ((key.name === 'return' || key.name === 'enter') && matches.length > 0) {
            key.preventDefault();
            onJumpToMessage(matches[matchIndex]?.messageIndex ?? 0);
        } else if (key.name === 'down' && matches.length > 0) {
            key.preventDefault();
            setMatchIndex((prev) => (prev + 1) % matches.length);
        } else if (key.name === 'up' && matches.length > 0) {
            key.preventDefault();
            setMatchIndex(
                (prev) => (prev - 1 + matches.length) % matches.length,
            );
        }
    });

    if (!isOpen) return null;

    return (
        <box
            flexDirection="column"
            border={['top']}
            borderColor={colors.dimSeparator}
            width="100%"
            paddingX={2}
            paddingY={1}
            backgroundColor={colors.surface}
        >
            <box flexDirection="row" gap={2} alignItems="center">
                <text attributes={TextAttributes.DIM}>Search:</text>
                <input
                    ref={inputRef}
                    value={searchText}
                    onChange={(val: string) => setSearchText(val)}
                    width={40}
                    placeholder="Type to search..."
                />
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    {matches.length > 0
                        ? `${matchIndex + 1}/${matches.length}`
                        : 'No matches'}
                </text>
                <text
                    fg={colors.info}
                    attributes={TextAttributes.DIM}
                    {...({ onClick: onClose } as any)}
                >
                    [Esc]
                </text>
            </box>
        </box>
    );
}
