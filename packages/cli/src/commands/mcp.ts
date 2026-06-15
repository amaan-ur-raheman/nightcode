import { loadSettings, saveSettings } from '@/lib/settings';

interface McpAddOptions {
    name: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
}

export function sanitizeConfig(obj: any, maskAll: boolean = false): any {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map((item) => sanitizeConfig(item, maskAll));
    }

    const sanitized: Record<string, any> = {};
    const secretKeys = new Set([
        'authorization',
        'token',
        'apikey',
        'api_key',
        'password',
        'secret',
        'accesstoken',
    ]);

    for (const [key, value] of Object.entries(obj)) {
        const isSecretKey = secretKeys.has(key.toLowerCase());
        const shouldMaskCurrent = maskAll || isSecretKey;

        if (key === 'headers' || key === 'env') {
            sanitized[key] = sanitizeConfig(value, true);
        } else if (shouldMaskCurrent && typeof value !== 'object') {
            sanitized[key] = '[MASKED]';
        } else {
            sanitized[key] = sanitizeConfig(value, shouldMaskCurrent);
        }
    }
    return sanitized;
}

export async function mcpAddCommand(options: McpAddOptions): Promise<void> {
    const settings = loadSettings();

    if (!settings.mcp) {
        settings.mcp = { servers: {} };
    }

    if (settings.mcp.servers[options.name]) {
        console.error(`MCP server "${options.name}" already exists.`);
        console.log('Use `nightcode mcp remove` to remove it first.');
        process.exit(1);
    }

    const serverConfig: any = {};

    if (options.url) {
        serverConfig.url = options.url;
        if (options.env) {
            serverConfig.headers = {};
            for (const [key, value] of Object.entries(options.env)) {
                serverConfig.headers[key] = value;
            }
        }
    } else if (options.command) {
        serverConfig.command = options.command;
        if (options.args) {
            serverConfig.args = options.args;
        }
        if (options.env) {
            serverConfig.env = options.env;
        }
    } else {
        console.error('Either --command or --url must be specified.');
        process.exit(1);
    }

    settings.mcp.servers[options.name] = serverConfig;
    saveSettings(settings);

    console.log(`\n[OK] Added MCP server "${options.name}"\n`);
    console.log('Configuration:');
    console.log(JSON.stringify(sanitizeConfig(serverConfig), null, 2));
    console.log('\nRestart NightCode to use the new server.\n');
}

export async function mcpRemoveCommand(name: string): Promise<void> {
    const settings = loadSettings();

    if (!settings.mcp?.servers?.[name]) {
        console.error(`MCP server "${name}" not found.`);
        process.exit(1);
    }

    delete settings.mcp.servers[name];
    saveSettings(settings);

    console.log(`\n[OK] Removed MCP server "${name}"\n`);
}

export async function mcpListCommand(): Promise<void> {
    const settings = loadSettings();
    const servers = settings.mcp?.servers || {};
    const names = Object.keys(servers);

    if (names.length === 0) {
        console.log('\nNo MCP servers configured.\n');
        console.log('Add one with: nightcode mcp add <name> --command <cmd>\n');
        return;
    }

    console.log('\nConfigured MCP servers:\n');

    for (const name of names) {
        const server = servers[name];
        if (!server || typeof server !== 'object') continue;

        let type = '<unknown>';
        let details = '<missing configuration>';

        if (server.url) {
            type = 'HTTP';
            details = String(server.url);
        } else if (server.command) {
            type = 'Stdio';
            const args = Array.isArray(server.args) ? server.args : [];
            const cleanArgs = args
                .filter((arg: any) => arg !== undefined && arg !== null)
                .map(String);
            details = `${String(server.command)}${cleanArgs.length > 0 ? ' ' + cleanArgs.join(' ') : ''}`;
        }

        console.log(`  ${name} (${type})`);
        console.log(`    ${details}`);
    }

    console.log('\n');
}
