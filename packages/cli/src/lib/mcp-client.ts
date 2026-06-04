import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { loadMcpServers, type McpServerConfig } from "@/lib/settings";

export type McpToolSchema = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverName: string;
};

// Active MCP clients keyed by server name
const clients = new Map<string, Client>();

async function connectServer(name: string, config: McpServerConfig): Promise<Client> {
    const existing = clients.get(name);
    if (existing) return existing;

    const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env,
        stderr: "ignore",
    });

    const client = new Client({ name: "nightcode", version: "1.0.0" });
    await client.connect(transport);
    clients.set(name, client);
    return client;
}

export async function loadMcpTools(): Promise<McpToolSchema[]> {
    const servers = loadMcpServers();
    const tools: McpToolSchema[] = [];

    await Promise.allSettled(
        servers.map(async ({ name, config }) => {
            try {
                const client = await connectServer(name, config);
                const result = await client.listTools();
                for (const tool of result.tools) {
                    tools.push({
                        name: `mcp__${name}__${tool.name}`,
                        description: tool.description ?? "",
                        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
                        serverName: name,
                    });
                }
            } catch {
                // skip unreachable servers
            }
        })
    );

    return tools;
}

export function isConnected(serverName: string): boolean {
    return clients.has(serverName);
}

export async function callMcpTool(
    prefixedName: string,
    input: unknown
): Promise<unknown> {
    // name format: mcp__<serverName>__<toolName>
    const parts = prefixedName.split("__");
    if (parts.length < 3 || parts[0] !== "mcp") {
        throw new Error(`Invalid MCP tool name format: "${prefixedName}"`);
    }
    const serverName = parts[1]!;
    const toolName = parts.slice(2).join("__");

    const client = clients.get(serverName);
    if (!client) throw new Error(`MCP server "${serverName}" not connected`);

    const result = await client.callTool({ name: toolName, arguments: input as Record<string, unknown> });
    return result.content;
}
