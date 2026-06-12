import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ─── Subcommand handling ──────────────────────────────────────────────────────
const args = process.argv.slice(2);

// ─── Non-interactive mode ──────────────────────────────────────────────────
if (args.includes('--non-interactive') || args.includes('-n')) {
    const { runNonInteractive } = await import('./commands/non-interactive');
    await runNonInteractive(args);
    process.exit(0);
}

// ─── Debug mode flags ──────────────────────────────────────────────────────
import { debug } from '@/lib/debug';

const debugMode = args.includes('--debug') || args.includes('-d');
const verboseMode = args.includes('--verbose') || args.includes('-v');

if (debugMode) {
    debug.setEnabled(true);
    if (verboseMode) {
        debug.setVerbose(true);
    }
    debug.log('init', 'Debug mode enabled', { verbose: verboseMode });
}
// ────────────────────────────────────────────────────────────────────────────

if (args[0] === 'init') {
    const { initCommand } = await import('./commands/init');
    const templateIdx = args.indexOf('--template');
    let template: 'basic' | 'fullstack' | 'api' = 'basic';
    if (templateIdx !== -1) {
        const val = args[templateIdx + 1];
        if (val === 'basic' || val === 'fullstack' || val === 'api') {
            template = val;
        } else {
            console.error(
                `Error: Invalid template "${val ?? ''}". Allowed templates: basic, fullstack, api`,
            );
            process.exit(1);
        }
    }
    // Collect positional args: skip "init" and anything consumed by --template
    const positional: string[] = [];
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === undefined) continue;
        if (arg === '--template') {
            i++;
            continue;
        } // skip flag + value
        if (arg.startsWith('--')) continue; // skip other flags
        positional.push(arg);
    }
    initCommand({
        name: positional[0] ?? '',
        template,
        git: !args.includes('--no-git'),
    });
    process.exit(0);
}

if (args[0] === 'mcp') {
    const { mcpAddCommand, mcpRemoveCommand, mcpListCommand } =
        await import('./commands/mcp');

    const subcommand = args[1];

    switch (subcommand) {
        case 'add': {
            const name = args[2];
            if (!name) {
                console.error('Error: server name is required.');
                console.log('Usage: nightcode mcp add <name> --command <cmd>');
                process.exit(1);
            }

            const commandIdx = args.indexOf('--command');
            const urlIdx = args.indexOf('--url');
            const command =
                commandIdx !== -1 ? args[commandIdx + 1] : undefined;
            const url = urlIdx !== -1 ? args[urlIdx + 1] : undefined;

            const argsIdx = args.indexOf('--args');
            const serverArgs =
                argsIdx !== -1
                    ? args.slice(argsIdx + 1).filter((a) => !a.startsWith('--'))
                    : undefined;

            const envIdx = args.indexOf('--env');
            const env: Record<string, string> = {};
            if (envIdx !== -1) {
                for (let i = envIdx + 1; i < args.length; i++) {
                    const arg = args[i];
                    if (arg === undefined) break;
                    if (arg.startsWith('--')) break;
                    const parts = arg.split('=');
                    const key = parts[0];
                    const value = parts[1];
                    if (key && value) env[key] = value;
                }
            }

            await mcpAddCommand({
                name,
                command,
                args: serverArgs,
                url,
                env: Object.keys(env).length > 0 ? env : undefined,
            });
            break;
        }

        case 'remove': {
            const name = args[2];
            if (!name) {
                console.error('Error: server name is required.');
                console.log('Usage: nightcode mcp remove <name>');
                process.exit(1);
            }
            await mcpRemoveCommand(name);
            break;
        }

        case 'list':
            await mcpListCommand();
            break;

        default:
            console.log('\nUsage: nightcode mcp <command>\n');
            console.log('Commands:');
            console.log(
                '  add <name> --command <cmd>    Add a stdio MCP server',
            );
            console.log(
                '  add <name> --url <url>        Add an HTTP MCP server',
            );
            console.log('  remove <name>                 Remove an MCP server');
            console.log('  list                          List all MCP servers');
            console.log('\nOptions:');
            console.log(
                '  --args <arg1> <arg2> ...      Arguments for stdio servers',
            );
            console.log(
                '  --env KEY=VALUE ...           Environment variables',
            );
            console.log('\nExamples:');
            console.log(
                '  nightcode mcp add filesystem --command npx --args -y @modelcontextprotocol/server-filesystem .',
            );
            console.log(
                '  nightcode mcp add remote --url http://localhost:3000/mcp',
            );
            console.log('\n');
            break;
    }

    process.exit(0);
}

if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: nightcode [command]

Commands:
  (default)     Start the TUI
  init [name]   Initialize a new NightCode project
  mcp <cmd>     Manage MCP servers (add, remove, list)

Options:
  --non-interactive, -n   Run in non-interactive mode (pipe-friendly)
  --prompt <text>         Input prompt (for non-interactive mode)
  --file <path>           Input file (for non-interactive mode)
  --timeout <ms>          Timeout in milliseconds (default: 30000)
  --template              Project template: basic, fullstack, api (default: basic)
  --no-git                Skip git initialization
  --debug, -d             Enable debug logging
  --verbose, -v           Show detailed data in debug logs (use with --debug)
  --help, -h              Show this help message

Examples:
  echo "What is 2+2?" | nightcode --non-interactive
  nightcode -n --prompt "What is 2+2?"
  nightcode -n --file input.txt
`);
    process.exit(0);
}
// ───────────────────────────────────────────────────────────────────────────────

import { createMemoryRouter, RouterProvider } from 'react-router';

import { createRoot } from '@opentui/react';
import { createCliRenderer } from '@opentui/core';

import { RootLayout } from '@/layouts/root-layout';
import { ErrorBoundary } from '@/components/error-boundary';

import { Home } from '@/screens/home';
import { Session } from '@/screens/session';
import { NewSession } from '@/screens/new-session';
import { toolAnalytics } from '@/lib/tool-analytics';
import { auditLog } from '@/lib/audit-log';

const NIGHTCODE_DIR = join(homedir(), '.nightcode');
const LAST_SESSION_FILE = join(NIGHTCODE_DIR, 'last-session');

export const lastSession = {
    id: null as string | null,
    title: null as string | null,
};

export function readLastSession(): { id: string; title: string } | null {
    try {
        const data = readFileSync(LAST_SESSION_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

export function writeLastSession(data: { id: string; title: string } | null) {
    try {
        mkdirSync(NIGHTCODE_DIR, { recursive: true });
        if (data) {
            writeFileSync(LAST_SESSION_FILE, JSON.stringify(data));
        }
    } catch {
        /* ignore */
    }
}

const savedSession = readLastSession();

const initialEntry = process.env.NIGHTCODE_SESSION_ID
    ? `/sessions/${process.env.NIGHTCODE_SESSION_ID}`
    : '/';

import { useRouteError } from 'react-router';

function RouteErrorBoundary() {
    const error = useRouteError() as any;
    try {
        const { writeFileSync, mkdirSync } = require('fs');
        const { join } = require('path');
        const { homedir } = require('os');
        const dir = join(homedir(), '.nightcode');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'error-boundary-crash.log'),
            error?.stack || error?.message || String(error),
        );
    } catch {
        /* ignore */
    }
    return (
        <box flexDirection="column" padding={1} gap={1}>
            <text fg="#f38ba8">NightCode Route Error:</text>
            <text fg="#cdd6f4">{error?.message || String(error)}</text>
        </box>
    );
}

const router = createMemoryRouter(
    [
        {
            path: '/',
            element: <RootLayout />,
            ErrorBoundary: RouteErrorBoundary,
            children: [
                { index: true, element: <Home savedSession={savedSession} /> },
                { path: 'sessions/new', element: <NewSession /> },
                { path: 'sessions/:id', element: <Session /> },
            ],
        },
    ],
    { initialEntries: [initialEntry] },
);

function App() {
    return (
        <ErrorBoundary>
            <RouterProvider router={router} />
        </ErrorBoundary>
    );
}

process.on('exit', () => {
    if (lastSession.id) {
        writeLastSession({
            id: lastSession.id,
            title: lastSession.title ?? '',
        });
    }
    toolAnalytics.save();
    auditLog.destroy();
});

process.on('SIGINT', async () => {
    await toolAnalytics.save();
    await auditLog.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await toolAnalytics.save();
    await auditLog.destroy();
    process.exit(0);
});

const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false,
});

renderer.once('destroy', async () => {
    if (lastSession.id) {
        writeLastSession({
            id: lastSession.id,
            title: lastSession.title ?? '',
        });
    }
    await toolAnalytics.save();
    await auditLog.destroy();
});

createRoot(renderer).render(<App />);
