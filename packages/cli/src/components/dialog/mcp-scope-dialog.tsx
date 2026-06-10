import { useCallback, useMemo, useState } from "react";

import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "@/providers/theme";
import { useKeyboardLayer } from "@/providers/keyboard-layer";
import { useDialog } from "@/providers/dialog";
import { loadMcpServers } from "@/lib/settings";
import { isConnected, getServerToolCount } from "@/lib/mcp-client";
import { mcpScope } from "@/lib/mcp-scope";

export function MCPScopeDialogContent({ onApplied }: { onApplied?: () => void }) {
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const dialog = useDialog();

    const allServers = useMemo(() => {
        try {
            return loadMcpServers();
        } catch {
            return [];
        }
    }, []);

    const initialActive = useMemo(() => {
        const active = mcpScope.getActiveServers();
        if (active) return new Set(active);
        return new Set(allServers.map((s) => s.name));
    }, [allServers]);

    const [selected, setSelected] = useState<Set<string>>(new Set(initialActive));
    const [selectedIndex, setSelectedIndex] = useState(0);

    const toggleServer = useCallback((name: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    }, []);

    const applyScope = useCallback(async () => {
        const allSelected = selected.size === allServers.length;
        await mcpScope.setSessionScope(allSelected ? [] : Array.from(selected));
        onApplied?.();
        dialog.close();
    }, [selected, allServers, dialog, onApplied]);

    useKeyboard((key) => {
        if (!isTopLayer("dialog")) return;

        if (key.name === "escape") {
            key.preventDefault();
            dialog.close();
        } else if (key.name === "return" || key.name === "enter") {
            key.preventDefault();
            applyScope();
        } else if (key.name === "up") {
            setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (key.name === "down") {
            setSelectedIndex((i) => Math.min(i + 1, allServers.length - 1));
        } else if (key.name === "space") {
            key.preventDefault();
            const server = allServers[selectedIndex];
            if (server) toggleServer(server.name);
        } else if (key.name === "a" && !key.ctrl && !key.meta) {
            // Select all
            if (selected.size === allServers.length) {
                setSelected(new Set());
            } else {
                setSelected(new Set(allServers.map((s) => s.name)));
            }
        }
    });

    if (allServers.length === 0) {
        return (
            <box flexDirection="column" gap={1} padding={1}>
                <text attributes={TextAttributes.DIM}>No MCP servers configured.</text>
                <text attributes={TextAttributes.DIM}>
                    Add servers to ~/.nightcode/settings.json under "mcp.servers"
                </text>
                <text attributes={TextAttributes.DIM} marginTop={1}>
                    Press Esc to close
                </text>
            </box>
        );
    }

    return (
        <box flexDirection="column" gap={1} padding={1}>
            <text>
                <text attributes={TextAttributes.DIM}>
                    Space to toggle, Enter to apply, A to select all, Esc to cancel
                </text>
            </text>
            {allServers.map((server, i) => {
                const isActive = selected.has(server.name);
                const connected = isConnected(server.name);
                const toolCount = getServerToolCount(server.name);
                const isHighlighted = i === selectedIndex;
                return (
                    <box
                        key={server.name}
                        flexDirection="row"
                        gap={1}
                        height={1}
                        backgroundColor={isHighlighted ? colors.selection : undefined}
                    >
                        <text fg={isActive ? colors.success : colors.dimSeparator}>
                            {isActive ? "●" : "○"}
                        </text>
                        <text fg={connected ? colors.text : colors.dimSeparator}>
                            {server.name}
                        </text>
                        {connected && toolCount > 0 ? (
                            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                                {`${toolCount} tool${toolCount !== 1 ? "s" : ""}`}
                            </text>
                        ) : null}
                    </box>
                );
            })}
            <text attributes={TextAttributes.DIM} marginTop={1}>
                {selected.size === allServers.length
                    ? "All servers active (no scope)"
                    : `${selected.size}/${allServers.length} servers active`}
            </text>
        </box>
    );
}
