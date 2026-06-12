import type { RefObject } from 'react';

import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';

import { useTheme } from '@/providers/theme';

import { COMMANDS } from '@/components/command-menu/commands';
import type { MenuItem } from '@/components/command-menu/use-command-menu';

const MAX_VISIBLE_ITEMS = 10;
const COMMAND_COLUMN_WIDTH =
    Math.max(...COMMANDS.map((cmd) => cmd.name.length)) + 4;

type CommandMenuProps = {
    query: string;
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    onSelect: (index: number) => void;
    onExecute: (index: number) => void;
    items: MenuItem[];
};

export function CommandMenu({
    query,
    selectedIndex,
    scrollRef,
    onSelect,
    onExecute,
    items,
}: CommandMenuProps) {
    const { colors } = useTheme();

    const selectableCount = items.length;
    const visibleHeight = Math.min(selectableCount, MAX_VISIBLE_ITEMS);

    if (selectableCount === 0) {
        return (
            <box paddingX={1}>
                <text attributes={TextAttributes.DIM}>
                    No matching commands found.
                </text>
            </box>
        );
    }

    return (
        <scrollbox ref={scrollRef} height={visibleHeight}>
            {items.map((item, idx) => {
                const { command: cmd, flatIndex } = item;
                const isSelected = flatIndex === selectedIndex;
                return (
                    <box
                        key={cmd.value}
                        flexDirection="row"
                        paddingX={1}
                        height={1}
                        overflow="hidden"
                        backgroundColor={
                            isSelected ? colors.selection : undefined
                        }
                        onMouseMove={() => onSelect(flatIndex)}
                        onMouseDown={() => onExecute(flatIndex)}
                    >
                        <box width={COMMAND_COLUMN_WIDTH} flexShrink={0}>
                            <text
                                selectable={false}
                                fg={isSelected ? 'black' : 'white'}
                            >
                                /{cmd.name}
                            </text>
                        </box>
                        <box flexGrow={1} flexShrink={1} overflow="hidden">
                            <text
                                selectable={false}
                                fg={isSelected ? 'black' : 'gray'}
                            >
                                {cmd.description}
                            </text>
                        </box>
                        {cmd.shortcut && (
                            <box flexShrink={0}>
                                <text
                                    selectable={false}
                                    fg={isSelected ? 'black' : 'gray'}
                                >
                                    {cmd.shortcut}
                                </text>
                            </box>
                        )}
                    </box>
                );
            })}
        </scrollbox>
    );
}
