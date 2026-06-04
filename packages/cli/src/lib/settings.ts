import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type McpServerConfig = {
    command: string;
    args?: string[];
    env?: Record<string, string>;
};

export type McpServer = {
    name: string;
    config: McpServerConfig;
    toolCount?: number;
};

export type Settings = {
    mcp?: {
        servers: Record<string, McpServerConfig>;
    };
};

const SETTINGS_PATH = join(homedir(), ".nightcode", "settings.json");

export function loadSettings(): Settings {
    if (!existsSync(SETTINGS_PATH)) return {};

    try {
        const raw = readFileSync(SETTINGS_PATH, "utf8");
        return JSON.parse(raw) as Settings;
    } catch {
        return {};
    }
}

export function loadMcpServers(): McpServer[] {
    const settings = loadSettings();
    if (!settings.mcp?.servers) return [];

    return Object.entries(settings.mcp.servers).flatMap(([name, config]) => {
        if (name.includes("__")) {
            console.warn(`MCP server name "${name}" contains "__" and will be skipped.`);
            return [];
        }
        return [{ name, config }];
    });
}
