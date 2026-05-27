import type { RefObject } from "react";

import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";

import { useTheme } from "@/providers/theme";

import { COMMANDS } from "@/components/command-menu/commands";
import { getFilteredCommands } from "@/components/command-menu/filter-commands";

const MAX_VISIBLE_ITEMS = 8;
const COMMAND_COLUMN_WIDTH = Math.max(...COMMANDS.map((cmd) => cmd.name.length)) + 4;

type CommandMenuProps = {
    query: string;
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    onSelect: (index: number) => void;
    onExecute: (index: number) => void;
}

export function CommandMenu({
    query,
    selectedIndex,
    scrollRef,
    onSelect,
    onExecute,
}: CommandMenuProps) {
    const { colors } = useTheme()
    const filtered = getFilteredCommands(query);
    const visibleHeight = Math.min(filtered.length, MAX_VISIBLE_ITEMS);

    if (filtered.length === 0) {
        return (
            <box paddingX={1}>
                <text attributes={TextAttributes.DIM}>No matching commands found.</text>
            </box>
        )
    }

    return (
        <scrollbox ref={scrollRef} height={visibleHeight}>
            {filtered.map((cmd, i) => {
                const isSelected = i === selectedIndex;
                return (
                    <box
                        key={cmd.value}
                        flexDirection="row"
                        paddingX={1}
                        height={1}
                        overflow="hidden"
                        backgroundColor={isSelected ? colors.selection : undefined}
                        onMouseMove={() => onSelect(i)}
                        onMouseDown={() => onExecute(i)}
                    >
                        <box width={COMMAND_COLUMN_WIDTH} flexShrink={0}>
                            <text selectable={false} fg={isSelected ? "black" : "white"}>
                                /{cmd.name}
                            </text>
                        </box>
                        <box flexGrow={1} flexShrink={1} overflow="hidden">
                            <text selectable={false} fg={isSelected ? "black" : "gray"}>
                                {cmd.description}
                            </text>
                        </box>
                    </box>
                )
            })}
        </scrollbox>
    )
}
