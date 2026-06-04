import { useMemo } from "react";

import { TextAttributes } from "@opentui/core";
import { loadMcpServers, type McpServer } from "@/lib/settings";
import { isConnected } from "@/lib/mcp-client";

export function McpDialogContent() {
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
            {servers.map((server: McpServer) => (
                <box key={server.name} flexDirection="row" gap={2} height={1}>
                    <text fg={isConnected(server.name) ? "green" : "gray"}>●</text>
                    <text>{server.name}</text>
                </box>
            ))}
        </box>
    );
}
