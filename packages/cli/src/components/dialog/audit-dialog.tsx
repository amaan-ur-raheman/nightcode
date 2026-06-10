import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";

import { useTheme } from "@/providers/theme";
import { useKeyboardLayer } from "@/providers/keyboard-layer";
import { auditLog, type AuditEntry } from "@/lib/audit-log";

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: string): string {
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString();
    } catch {
        return ts;
    }
}

export function AuditDialogContent() {
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const searchQueryRef = useRef(searchQuery);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        searchQueryRef.current = searchQuery;
    }, [searchQuery]);

    useEffect(() => {
        loadEntries();
    }, []);

    async function loadEntries() {
        setLoading(true);
        const query = searchQueryRef.current;
        const data = query
            ? await auditLog.search(query)
            : await auditLog.getRecent(50);
        setEntries(data);
        setLoading(false);
    }

    useKeyboard((key) => {
        if (!isTopLayer("dialog")) return;
        if (key.name === "return" || key.name === "enter") {
            loadEntries();
        }
    });

    if (loading) {
        return (
            <box padding={2}>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>Loading...</text>
            </box>
        );
    }

    return (
        <box flexDirection="column" width="100%">
            <box flexDirection="row" gap={2} alignItems="center" marginBottom={1}>
                <box flexGrow={1} border={["bottom", "left", "right", "top"]} borderColor={colors.dimSeparator} paddingX={1}>
                    <input
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Search tool executions..."
                    />
                </box>
                <text
                    fg={colors.primary}
                    onMouseDown={() => loadEntries()}
                >
                    [Search]
                </text>
            </box>

            {entries.length === 0 ? (
                <box padding={1}>
                    <text fg={colors.dimSeparator}>No entries found</text>
                </box>
            ) : (
                <box flexDirection="column" gap={0}>
                    <box flexDirection="row" border={["bottom"]} borderColor={colors.dimSeparator} paddingBottom={0}>
                        <box width={10}><text attributes={TextAttributes.BOLD} fg={colors.primary}>Time</text></box>
                        <box flexGrow={1}><text attributes={TextAttributes.BOLD} fg={colors.primary}>Tool</text></box>
                        <box width={12}><text attributes={TextAttributes.BOLD} fg={colors.primary}>Duration</text></box>
                        <box width={8} alignItems="center"><text attributes={TextAttributes.BOLD} fg={colors.primary}>Status</text></box>
                    </box>
                    <scrollbox height={10}>
                        {entries.map((entry, i) => (
                            <box key={i} flexDirection="row" border={["bottom"]} borderColor={colors.dimSeparator} paddingY={0}>
                                <box width={10}><text fg={colors.dimSeparator}>{formatTimestamp(entry.timestamp)}</text></box>
                                <box flexGrow={1}><text fg={colors.text}>{entry.tool}</text></box>
                                <box width={12}><text fg={colors.dimSeparator}>{formatDuration(entry.duration)}</text></box>
                                <box width={8} alignItems="center">
                                    <text fg={entry.success ? colors.success : colors.error}>
                                        {entry.success ? "✓" : "✗"}
                                    </text>
                                </box>
                            </box>
                        ))}
                    </scrollbox>
                </box>
            )}
        </box>
    );
}
