import type { RefObject } from 'react';

import { TextAttributes } from '@opentui/core';
import type { ScrollBoxRenderable } from '@opentui/core';

import { useTheme } from '@/providers/theme';

import type { MentionCandidate } from '@/components/file-mention/use-file-mention';

const MAX_VISIBLE_MENTIONS = 8;

type FileMentionMenuProps = {
    candidates: MentionCandidate[];
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    onSelect: (index: number) => void;
    onExecute: (index: number) => void;
};

export function FileMentionMenu({
    candidates,
    selectedIndex,
    scrollRef,
    onSelect,
    onExecute,
}: FileMentionMenuProps) {
    const { colors } = useTheme();
    const visibleHeight = Math.min(candidates.length, MAX_VISIBLE_MENTIONS);

    if (candidates.length === 0) {
        return (
            <box paddingX={1}>
                <text attributes={TextAttributes.DIM}>
                    No matching files or folders
                </text>
            </box>
        );
    }

    return (
        <scrollbox ref={scrollRef} height={visibleHeight}>
            {candidates.map((candidate, index) => {
                const isSelected = index === selectedIndex;
                return (
                    <box
                        key={candidate.path}
                        flexDirection="row"
                        paddingX={1}
                        height={1}
                        overflow="hidden"
                        backgroundColor={
                            isSelected ? colors.selection : undefined
                        }
                        onMouseMove={() => onSelect(index)}
                        onMouseDown={() => onExecute(index)}
                    >
                        <box flexGrow={1} flexShrink={1} overflow="hidden">
                            <text
                                selectable={false}
                                fg={isSelected ? 'black' : 'white'}
                            >
                                {candidate.path}
                            </text>
                        </box>
                        <box width={8} alignItems="flex-end" flexShrink={0}>
                            <text
                                selectable={false}
                                fg={isSelected ? 'black' : 'gray'}
                            >
                                {candidate.kind === 'directory'
                                    ? 'Folder'
                                    : 'File'}
                            </text>
                        </box>
                    </box>
                );
            })}
        </scrollbox>
    );
}
