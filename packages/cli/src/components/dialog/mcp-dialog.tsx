import { useMemo } from "react";

import { TextAttributes } from "@opentui/core";
import { loadMcpServers, type McpServer } from "@/lib/settings";
import { isConnected, getServerToolCount } from "@/lib/mcp-client";
import { useTheme } from "@/providers/theme";

export function McpDialogContent() {
    const { colors } = useTheme();
    const servers = useMemo(() => {
        try {
            return loadMcpServers();
        } catch (error) {
            console.error("Failed to load MCP servers:", error);
            return [];
        }
    }, []);

    if (servers.length === 0) {
        return (
            <box flexDirection="column" gap={1} paddingY={1}>
                <text attributes={TextAttributes.DIM}>No MCP servers configured.</text>
                <text attributes={TextAttributes.DIM}>
                    Add servers to ~/.nightcode/settings.json under "mcp.servers"
                </text>
            </box>
        );
    }

    return (
        <box flexDirection="column" gap={1}>
            {servers.map((server: McpServer) => {
                const connected = isConnected(server.name);
                const toolCount = getServerToolCount(server.name);
                return (
                    <box key={server.name} flexDirection="column" gap={0}>
                        <box flexDirection="row" gap={2} height={1}>
                            <text fg={connected ? colors.success : colors.dimSeparator}>
                                {connected ? "●" : "○"}
                            </text>
                            <text>{server.name}</text>
                            {connected && toolCount > 0 ? (
                                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                                    {`${toolCount} tool${toolCount !== 1 ? "s" : ""}`}
                                </text>
                            ) : null}
                        </box>
                        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator} paddingLeft={3}>
                            {server.config.command} {(server.config.args ?? []).join(" ")}
                        </text>
                    </box>
                );
            })}
            <box marginTop={1}>
                <text attributes={TextAttributes.DIM}>
                    Press Esc to close
                </text>
            </box>
        </box>
    );
}
