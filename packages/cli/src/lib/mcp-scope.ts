import { loadSettings, saveSettings } from './settings';
import { debug } from './debug';

class MCPScopeManager {
    private activeServers: Set<string> | null = null;

    constructor() {
        this.loadSessionScope();
    }

    loadSessionScope(): void {
        const settings = loadSettings() || {};
        const servers = settings.session?.activeMcpServers;

        if (servers && servers.length > 0) {
            this.activeServers = new Set(servers);
            debug.log('mcp', `Session scoped to: ${servers.join(', ')}`);
        } else {
            this.activeServers = null;
            debug.log('mcp', 'Session using all MCP servers');
        }
    }

    setSessionScope(servers: string[]): void {
        const settings = loadSettings();

        if (!settings.session) {
            settings.session = {};
        }

        settings.session.activeMcpServers = servers.length > 0 ? servers : undefined;
        saveSettings(settings);

        this.activeServers = servers.length > 0 ? new Set(servers) : null;
        debug.log('mcp', `Session scope updated: ${servers.join(', ') || 'all'}`);
    }

    isServerActive(serverName: string): boolean {
        return this.activeServers === null || this.activeServers.has(serverName);
    }

    getActiveServers(): string[] | null {
        return this.activeServers ? Array.from(this.activeServers) : null;
    }
}

export const mcpScope = new MCPScopeManager();
