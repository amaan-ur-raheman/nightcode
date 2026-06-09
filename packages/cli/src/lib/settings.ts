import { readFileSync, existsSync, statSync } from "fs";
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

let _cachedSettings: Settings | null = null;
let _cachedMtime: number = 0;

export function loadSettings(): Settings {
    try {
        if (!existsSync(SETTINGS_PATH)) return {};

        const stat = statSync(SETTINGS_PATH);
        const mtimeMs = stat.mtimeMs;

        if (_cachedSettings && mtimeMs === _cachedMtime) {
            return _cachedSettings;
        }

        const raw = readFileSync(SETTINGS_PATH, "utf8");
        _cachedSettings = JSON.parse(raw) as Settings;
        _cachedMtime = mtimeMs;
        return _cachedSettings;
    } catch {
        _cachedSettings = null;
        _cachedMtime = 0;
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
