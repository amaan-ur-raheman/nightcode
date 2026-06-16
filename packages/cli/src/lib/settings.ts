import {
    readFileSync,
    writeFileSync,
    existsSync,
    statSync,
    mkdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type McpServerConfig = {
    // Stdio transport
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    // HTTP/SSE transport
    url?: string;
    headers?: Record<string, string>;
};

export type McpServer = {
    name: string;
    config: McpServerConfig;
    toolCount?: number;
};

export function getTransportType(config: McpServerConfig): 'http' | 'stdio' {
    return config.url ? 'http' : 'stdio';
}

export type AutonomyLevel = 'strict' | 'balanced' | 'full';

export type Settings = {
    mcp?: {
        servers: Record<string, McpServerConfig>;
    };
    session?: {
        activeMcpServers?: string[];
    };
    audit?: {
        enabled: boolean;
        retentionDays: number;
    };
    confirmations?: {
        enabled: boolean;
        alwaysConfirm?: string[];
        neverConfirm?: string[];
        autonomyLevel?: AutonomyLevel;
    };
    keychain?: {
        enabled: boolean;
        fallbackToEnv: boolean;
    };
    debug?: {
        enabled: boolean;
        verbose: boolean;
        retentionDays: number;
    };
    syntaxHighlight?: {
        enabled: boolean;
    };
    env?: {
        defaultFile?: string;
        protectedVars?: string[];
    };
    reasoning?: {
        enabled: boolean;
        mode: 'auto' | 'always' | 'never';
    };
    theme?: {
        name: string;
        isCustom?: boolean;
    };
    batch?: {
        enabled: boolean;
        maxBatchSize?: number;
        maxWaitTime?: number;
        enabledTools?: string[];
    };
    snapshots?: {
        enabled: boolean;
        autoUpdate?: boolean;
    };
    analytics?: {
        enabled: boolean;
        retainDays?: number;
    };
    queue?: {
        enabled: boolean;
        maxConcurrent?: number;
        maxRetries?: number;
        retryDelay?: number;
    };
    accessibility?: {
        reduceMotion?: boolean;
        highContrast?: boolean;
    };
};

const SETTINGS_PATH = join(homedir(), '.nightcode', 'settings.json');

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

        const raw = readFileSync(SETTINGS_PATH, 'utf8');
        _cachedSettings = JSON.parse(raw) as Settings;
        _cachedMtime = mtimeMs;
        return _cachedSettings;
    } catch {
        _cachedSettings = null;
        _cachedMtime = 0;
        return {};
    }
}

export function saveSettings(settings: Settings): void {
    try {
        mkdirSync(join(homedir(), '.nightcode'), { recursive: true });
        writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        _cachedSettings = settings;
        _cachedMtime = statSync(SETTINGS_PATH).mtimeMs;
    } catch {
        // ignore
    }
}

export function isConfirmationEnabled(): boolean {
    const settings = loadSettings();
    return settings.confirmations?.enabled ?? true;
}

export function getAutonomyLevel(): AutonomyLevel {
    const settings = loadSettings();
    return settings.confirmations?.autonomyLevel ?? 'strict';
}

export function setAutonomyLevel(level: AutonomyLevel): void {
    const settings = loadSettings();
    settings.confirmations = {
        ...settings.confirmations,
        enabled: settings.confirmations?.enabled ?? true,
        autonomyLevel: level,
    };
    saveSettings(settings);
}

export function toggleConfirmations(): boolean {
    const settings = loadSettings();
    const enabled = !(settings.confirmations?.enabled ?? true);
    settings.confirmations = { ...settings.confirmations, enabled };
    saveSettings(settings);
    return enabled;
}

export function loadMcpServers(): McpServer[] {
    const settings = loadSettings();
    if (!settings.mcp?.servers) return [];

    return Object.entries(settings.mcp.servers).flatMap(([name, config]) => {
        if (name.includes('__')) {
            console.warn(
                `MCP server name "${name}" contains "__" and will be skipped.`,
            );
            return [];
        }
        return [{ name, config }];
    });
}

export function isReasoningEnabled(): boolean {
    const settings = loadSettings();
    return settings.reasoning?.enabled ?? false;
}

export function toggleReasoning(): boolean {
    const settings = loadSettings();
    const enabled = !(settings.reasoning?.enabled ?? false);
    settings.reasoning = {
        ...settings.reasoning,
        enabled,
        mode: settings.reasoning?.mode ?? 'auto',
    };
    saveSettings(settings);
    return enabled;
}

export function getReasoningMode(): 'auto' | 'always' | 'never' {
    const settings = loadSettings();
    return settings.reasoning?.mode ?? 'auto';
}

export function isReduceMotionEnabled(): boolean {
    const settings = loadSettings();
    return settings.accessibility?.reduceMotion ?? false;
}

export function toggleReduceMotion(): boolean {
    const settings = loadSettings();
    const enabled = !(settings.accessibility?.reduceMotion ?? false);
    settings.accessibility = {
        ...settings.accessibility,
        reduceMotion: enabled,
    };
    saveSettings(settings);
    return enabled;
}

export function isHighContrastEnabled(): boolean {
    const settings = loadSettings();
    return settings.accessibility?.highContrast ?? false;
}

export function toggleHighContrast(): boolean {
    const settings = loadSettings();
    const enabled = !(settings.accessibility?.highContrast ?? false);
    settings.accessibility = {
        ...settings.accessibility,
        highContrast: enabled,
    };
    saveSettings(settings);
    return enabled;
}
