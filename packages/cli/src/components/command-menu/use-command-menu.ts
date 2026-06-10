import { useRef, useState, useMemo, type RefObject } from "react";

import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";

import { useKeyboardLayer } from "@/providers/keyboard-layer";
import { usePromptConfig } from "@/providers/prompt-config";
import { useRecentCommands, recentCommands } from "@/hooks/use-recent-commands";
import { getFilteredCommands, type FilteredCommand } from "@/components/command-menu/filter-commands";
import type { Command, CommandCategory } from "@/components/command-menu/types";
import type { ModeType } from "@nightcode/shared";

export type MenuItem =
    | { type: "header"; label: string }
    | { type: "command"; command: FilteredCommand; flatIndex: number }
    | { type: "spacer" };

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
    session: "Session",
    mcp: "MCP",
    settings: "Settings",
    account: "Account",
    debug: "Debug",
};

export function buildMenuItems(
    query: string,
    recentIds: string[],
    mode: ModeType,
    sessionId?: string,
): { items: MenuItem[]; selectableCommands: FilteredCommand[] } {
    const items: MenuItem[] = [];
    const selectableCommands: FilteredCommand[] = [];

    const filtered = getFilteredCommands(query, mode, sessionId);

    if (!query) {
        // Show recent commands first (non-duplicated)
        const recentCmds: FilteredCommand[] = [];
        for (const id of recentIds) {
            const cmd = filtered.find(c => c.value === id);
            if (cmd) recentCmds.push({ ...cmd, _score: 0 });
        }

        if (recentCmds.length > 0) {
            items.push({ type: "header", label: "Recent" });
            for (const cmd of recentCmds) {
                items.push({ type: "command", command: cmd, flatIndex: selectableCommands.length });
                selectableCommands.push(cmd);
            }
        }

        // Group remaining commands by category
        const usedIds = new Set(recentCmds.map(c => c.value));
        const byCategory = new Map<CommandCategory, FilteredCommand[]>();
        for (const cmd of filtered) {
            if (usedIds.has(cmd.value)) continue;
            const cat = cmd.category ?? "session";
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push({ ...cmd, _score: 0 });
        }

        const categoryOrder: CommandCategory[] = ["session", "mcp", "settings", "account", "debug"];
        for (const cat of categoryOrder) {
            const cmds = byCategory.get(cat);
            if (!cmds || cmds.length === 0) continue;
            if (items.length > 0) {
                items.push({ type: "spacer" });
            }
            items.push({ type: "header", label: CATEGORY_LABELS[cat] });
            for (const cmd of cmds) {
                items.push({ type: "command", command: cmd, flatIndex: selectableCommands.length });
                selectableCommands.push(cmd);
            }
        }
    } else {
        // Group fuzzy search results by category
        const byCategory = new Map<CommandCategory, FilteredCommand[]>();
        for (const cmd of filtered) {
            const cat = cmd.category ?? "session";
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(cmd);
        }

        const categoryOrder: CommandCategory[] = ["session", "mcp", "settings", "account", "debug"];
        for (const cat of categoryOrder) {
            const cmds = byCategory.get(cat);
            if (!cmds || cmds.length === 0) continue;
            if (items.length > 0) {
                items.push({ type: "spacer" });
            }
            items.push({ type: "header", label: CATEGORY_LABELS[cat] });
            for (const cmd of cmds) {
                items.push({ type: "command", command: cmd, flatIndex: selectableCommands.length });
                selectableCommands.push(cmd);
            }
        }
    }

    return { items, selectableCommands };
}

type UseCommandMenuReturn = {
    showCommandMenu: boolean;
    commandQuery: string;
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    handleContentChange: (text: string) => void;
    resolveCommand: (index: number) => Command | undefined;
    setSelectedIndex: (index: number) => void;
    trackRecent: (commandId: string) => Promise<void>;
    items: MenuItem[];
};

export function useCommandMenu(sessionId?: string): UseCommandMenuReturn {
    const [textValue, setTextValue] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showCommandMenu, setShowCommandMenu] = useState(false);
    const scrollRef = useRef<ScrollBoxRenderable>(null);
    const { push, pop, isTopLayer } = useKeyboardLayer();
    const { mode } = usePromptConfig();
    const recent = useRecentCommands();
    const recentIds = recent.getIds();

    const commandQuery = showCommandMenu && textValue.startsWith("/") ? textValue.slice(1) : "";

    const { items, selectableCommands } = useMemo(() => {
        return buildMenuItems(commandQuery, recentIds, mode, sessionId);
    }, [commandQuery, recentIds, mode, sessionId]);

    const close = () => {
        setShowCommandMenu(false);
        pop("command");
    };

    const handleContentChange = (text: string) => {
        setTextValue(text);
        setSelectedIndex(0);

        // Jump back to the top of the list when the user types a new character
        const scrollbox = scrollRef.current;
        if (scrollbox) {
            scrollbox.scrollTo(0);
        }

        const prefix = text.startsWith("/") ? text.slice(1) : null;
        if (prefix !== null && !prefix.includes(" ")) {
            setShowCommandMenu(true);
            push("command", () => {
                close();
                return true;
            });
        } else {
            close();
        }
    };

    // Resolve a command at a specific index (returns the command, caller handles execution)
    const resolveCommand = (index: number): Command | undefined => {
        const command = selectableCommands[index];
        if (command) {
            close();
        }

        return command;
    };

    const trackRecent = async (commandId: string) => {
        await recentCommands.add(commandId);
    };

    // Arrow keys move selection; the list follows along when highlight goes off screen
    useKeyboard((key) => {
        if (!showCommandMenu || !isTopLayer("command")) return;

        if (key.name === "escape") {
            key.preventDefault();
            close();
        } else if (key.name === "up" || (key.name === "p" && key.ctrl)) {
            key.preventDefault();
            setSelectedIndex((i: number) => {
                const newIndex = Math.max(0, i - 1);
                const visualIndex = items.findIndex(item => item.type === "command" && item.flatIndex === newIndex);

                // Keep the highlighted item visible when arrowing past the edge
                const sb = scrollRef.current;
                if (sb && visualIndex !== -1 && visualIndex < sb.scrollTop) {
                    sb.scrollTo(visualIndex);
                }

                return newIndex;
            });
        } else if (key.name === "down" || (key.name === "n" && key.ctrl)) {
            key.preventDefault();
            setSelectedIndex((i: number) => {
                if (selectableCommands.length === 0) {
                    return 0;
                }

                const newIndex = Math.min(selectableCommands.length - 1, i + 1);
                const visualIndex = items.findIndex(item => item.type === "command" && item.flatIndex === newIndex);

                // Keep the highlighted item visible when arrowing past the edge
                const sb = scrollRef.current;
                if (sb && visualIndex !== -1) {
                    const viewportHeight = sb.viewport.height;
                    const visibleEnd = sb.scrollTop + viewportHeight - 1;
                    if (visualIndex > visibleEnd) {
                        sb.scrollTo(visualIndex - viewportHeight + 1);
                    }
                }

                return newIndex;
            });
        }
    });

    return {
        showCommandMenu,
        commandQuery,
        selectedIndex,
        scrollRef,
        handleContentChange,
        resolveCommand,
        setSelectedIndex,
        trackRecent,
        items,
    };
}

