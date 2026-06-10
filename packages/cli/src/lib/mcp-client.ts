import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

import { loadMcpServers, type McpServerConfig } from "@/lib/settings";
import { debug } from "@/lib/debug";
import { mcpHealth } from "@/lib/mcp-health";
import { mcpScope } from "@/lib/mcp-scope";

export type McpToolSchema = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverName: string;
};

// Active MCP clients keyed by server name
const clients = new Map<string, Client>();
// Tool count per server, populated during loadMcpTools
const serverToolCounts = new Map<string, number>();

async function connectServer(name: string, config: McpServerConfig): Promise<Client> {
    const existing = clients.get(name);
    if (existing) return existing;

    debug.log("mcp", `Connecting to server: ${name}`, { transport: config.url ? "http" : "stdio" });

    const client = new Client({ name: "nightcode", version: "1.0.0" });

    if (config.url) {
        const url = new URL(config.url);
        const requestInit: RequestInit = config.headers
            ? { headers: config.headers }
            : {};

        // Try Streamable HTTP first, fall back to legacy SSE
        try {
            const transport = new StreamableHTTPClientTransport(url, { requestInit });
            await client.connect(transport);
        } catch {
            const sseTransport = new SSEClientTransport(url, { requestInit });
            await client.connect(sseTransport);
        }
    } else {
        if (!config.command) {
            throw new Error("MCP client: missing command when url is not provided");
        }
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: config.env,
            stderr: "ignore",
        });
        await client.connect(transport);
    }

    clients.set(name, client);

    // Register with health manager
    mcpHealth.register(name, client, () => connectServer(name, config));

    return client;
}

export async function loadMcpTools(): Promise<McpToolSchema[]> {
    await mcpScope.loadSessionScope();
    const servers = loadMcpServers();
    const tools: McpToolSchema[] = [];

    debug.log("mcp", "Loading MCP tools", { serverCount: servers.length });

    await Promise.allSettled(
        servers.map(async ({ name, config }) => {
            if (!mcpScope.isServerActive(name)) {
                debug.log("mcp", `Skipping server ${name} (not in session scope)`);
                serverToolCounts.set(name, 0);
                return;
            }

            try {
                const client = await connectServer(name, config);
                const result = await client.listTools();
                serverToolCounts.set(name, result.tools.length);
                debug.log("mcp", `Discovered ${result.tools.length} tools from ${name}`);
                for (const tool of result.tools) {
                    tools.push({
                        name: `mcp__${name}__${tool.name}`,
                        description: tool.description ?? "",
                        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
                        serverName: name,
                    });
                }
            } catch {
                serverToolCounts.set(name, 0);
                // skip unreachable servers
            }
        })
    );

    // Start health monitoring after initial connection
    mcpHealth.startMonitoring();

    return tools;
}

export function isConnected(serverName: string): boolean {
    return clients.has(serverName);
}

export function getServerToolCount(serverName: string): number {
    return serverToolCounts.get(serverName) ?? 0;
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

    debug.log("mcp", `Calling tool: ${toolName}`, { server: serverName });
    const result = await client.callTool({ name: toolName, arguments: input as Record<string, unknown> });
    debug.log("mcp", `Tool completed: ${toolName}`, { server: serverName, resultType: typeof result.content });
    return result.content;
}

export function getServerForTool(prefixedName: string): string | null {
    const parts = prefixedName.split("__");
    if (parts.length >= 3 && parts[0] === "mcp") {
        return parts[1]!;
    }
    return null;
}

export async function reconnectServer(name: string): Promise<boolean> {
    return mcpHealth.reconnect(name);
}
