import { homedir } from 'os';
import { join } from 'path';

import { cancelTask } from '@nightcode/shared';

import { clearAuth } from '@/lib/auth';
import { performLogin } from '@/lib/oauth';
import { openBillingPortal, openUpgradeCheckout } from '@/lib/upgrade';
import { undoManager } from '@/lib/undo-manager';
import { toggleConfirmations, toggleReasoning } from '@/lib/settings';
import { memory } from '@/lib/memory';
import { auditLog } from '@/lib/audit-log';
import { debug } from '@/lib/debug';
import {
    exportSession,
    exportToFile,
    importSession,
} from '@/lib/session-utils';
import { themeManager } from '@/lib/theme-manager';
import { toolAnalytics } from '@/lib/tool-analytics';
import { batchManager } from '@/lib/batch-manager';
import { orchestratorManager } from '@/lib/orchestrator-manager';

import type { Command } from '@/components/command-menu/types';
import {
    AgentsDialogContent,
    AuditDialogContent,
    HelpDialogContent,
    ImportDialogContent,
    McpDialogContent,
    MCPScopeDialogContent,
    ModelsDialogContent,
    OrchestrationDialogContent,
    QueueDialogContent,
    SessionDialogContent,
    SnapshotDialogContent,
    SkillsDialogContent,
    ThemeDialogContent,
    CommitDialogContent,
    TimelineDialogContent,
} from '@/components/dialog';
import { timelineManager } from '@/lib/timeline-manager';

export const COMMANDS: Command[] = [
    {
        name: 'help',
        description: 'Show available commands and shortcuts',
        value: '/help',
        shortcut: 'Ctrl+?',
        category: 'session',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Help',
                children: <HelpDialogContent />,
            });
        },
    },
    {
        name: 'history',
        description: 'Show visual playback timeline and rollback checkpoints',
        value: '/history',
        shortcut: 'Ctrl+H',
        category: 'session',
        action: (ctx) => {
            if (!ctx.sessionId) {
                ctx.toast.show({
                    message: 'No active session',
                    variant: 'error',
                });
                return;
            }
            ctx.dialog.open({
                title: 'Session Playback Timeline',
                width: 94,
                children: (
                    <TimelineDialogContent
                        sessionId={ctx.sessionId}
                        onRollback={async (commitHash) => {
                            const timeline = await timelineManager.loadTimeline(ctx.sessionId!);
                            const snapshot = Object.values(timeline.snapshots).find(
                                (s) => s.commitHash === commitHash
                            );
                            if (snapshot && snapshot.messageId !== 'main') {
                                await ctx.switchBranch(snapshot.messageId);
                            }
                            ctx.dialog.close();
                            ctx.toast.show({
                                message: 'Workspace rolled back successfully to checkpoint.',
                                variant: 'success',
                            });
                        }}
                    />
                ),
            });
        },
    },
    {
        name: 'new',
        description: 'Start a new conversation',
        value: '/new',
        category: 'session',
        action: (ctx) => {
            ctx.navigate('/');
        },
    },
    {
        name: 'clear',
        description: 'Clear chat history',
        value: '/clear',
        category: 'session',
        action: (ctx) => {
            ctx.clearMessages();
            ctx.toast.show({
                message: 'Chat cleared',
                variant: 'success',
            });
        },
    },
    {
        name: 'agents',
        description: 'Switch agents',
        value: '/agents',
        category: 'session',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Select Agent',
                children: (
                    <AgentsDialogContent
                        currentMode={ctx.mode}
                        onSelectMode={ctx.setMode}
                    />
                ),
            });
        },
    },
    {
        name: 'models',
        description: 'Select AI model for generation',
        value: '/models',
        category: 'session',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Select Model',
                children: (
                    <ModelsDialogContent
                        onSelectModel={(modelId) => ctx.setModel(modelId)}
                    />
                ),
            });
        },
    },
    {
        name: 'sessions',
        description: 'Browse past sessions',
        value: '/sessions',
        category: 'session',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Sessions',
                children: <SessionDialogContent />,
            });
        },
    },
    {
        name: 'theme',
        description: 'Change the theme',
        value: '/theme',
        shortcut: 'Ctrl+T',
        category: 'settings',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Select Theme',
                children: <ThemeDialogContent />,
            });
        },
    },
    {
        name: 'skills',
        description: 'Use a prompt skill',
        value: '/skills',
        category: 'session',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Select Skill',
                children: (
                    <SkillsDialogContent onSelectSkill={ctx.setInputValue} />
                ),
            });
        },
    },
    {
        name: 'mcp',
        description: 'View connected MCP servers',
        value: '/mcp',
        category: 'mcp',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'MCP Servers',
                children: <McpDialogContent />,
            });
        },
    },
    {
        name: 'mcp-scope',
        description: 'Restrict which MCP servers are active in this session',
        value: '/mcp-scope',
        category: 'mcp',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'MCP Session Scope',
                children: (
                    <MCPScopeDialogContent
                        onApplied={() => {
                            ctx.toast.show({
                                message: 'MCP scope updated',
                                variant: 'success',
                            });
                        }}
                    />
                ),
            });
        },
    },
    {
        name: 'login',
        description: 'Sign in with your browser',
        value: '/login',
        category: 'account',
        action: async (ctx) => {
            ctx.toast.show({ message: 'Opening browser to login...' });

            try {
                await performLogin();
                ctx.toast.show({
                    message: 'Login successful',
                    variant: 'success',
                });
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Sign in failed or timed out';

                ctx.toast.show({ variant: 'error', message });
            }
        },
    },
    {
        name: 'logout',
        description: 'Sign out of your account',
        value: '/logout',
        category: 'account',
        action: (ctx) => {
            clearAuth();
            ctx.toast.show({
                message: 'Signed out',
                variant: 'success',
            });
        },
    },
    {
        name: 'upgrade',
        description: 'Buy more credits',
        value: '/upgrade',
        category: 'account',
        action: async (ctx) => {
            ctx.toast.show({ message: 'Opening credits checkout...' });

            try {
                await openUpgradeCheckout();
                ctx.toast.show({
                    variant: 'success',
                    message: 'Checkout opened in browser',
                });
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Failed to open checkout';

                ctx.toast.show({ variant: 'error', message });
            }
        },
    },
    {
        name: 'usage',
        description: 'Open billing portal in the browser',
        value: '/usage',
        category: 'account',
        action: async (ctx) => {
            ctx.toast.show({ message: 'Opening billing portal...' });

            try {
                await openBillingPortal();
                ctx.toast.show({
                    variant: 'success',
                    message: 'Billing portal opened in browser',
                });
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Failed to open billing portal';

                ctx.toast.show({ variant: 'error', message });
            }
        },
    },
    {
        name: 'export',
        description: 'Export current session to a file',
        value: '/export',
        category: 'session',
        action: async (ctx) => {
            if (!ctx.sessionId) {
                ctx.toast.show({
                    message: 'No active session to export',
                    variant: 'error',
                });
                return;
            }
            try {
                ctx.toast.show({ message: 'Exporting session...' });
                const data = await exportSession(ctx.sessionId);
                const defaultPath = join(
                    homedir(),
                    '.nightcode',
                    'exports',
                    `nightcode-session-${data.session.title.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.json`,
                );
                exportToFile(defaultPath, data);
                ctx.toast.show({
                    message: `Exported to ~/.nightcode/exports/`,
                    variant: 'success',
                });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : 'Export failed';
                ctx.toast.show({ message, variant: 'error' });
            }
        },
    },
    {
        name: 'import',
        description: 'Import a session from ~/.nightcode/exports/',
        value: '/import',
        category: 'session',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Import Session',
                children: <ImportDialogContent />,
            });
        },
    },
    {
        name: 'exit',
        description: 'Quit the application',
        value: '/exit',
        category: 'session',
        action: (ctx) => {
            ctx.exit();
        },
    },
    {
        name: 'undo',
        description: 'Undo the last file change',
        value: '/undo',
        shortcut: 'Ctrl+Z',
        category: 'session',
        requiresBuildMode: true,
        action: async (ctx) => {
            const result = await undoManager.undoLast();
            if (!result) {
                ctx.toast.show({ message: 'Nothing to undo', variant: 'info' });
            } else if (result.restored) {
                ctx.toast.show({
                    message: `Undid changes to ${result.filePath}`,
                    variant: 'success',
                });
            } else {
                ctx.toast.show({
                    message: `Failed to undo ${result.filePath}`,
                    variant: 'error',
                });
            }
        },
    },
    {
        name: 'memory',
        description: 'Show stored memories',
        value: '/memory',
        category: 'session',
        action: async (ctx) => {
            try {
                const entries = await memory.list();
                if (entries.length === 0) {
                    ctx.toast.show({
                        message: 'No memories stored',
                        variant: 'info',
                    });
                    return;
                }
                const lines = entries.map(
                    (e) =>
                        `${e.key}: ${e.value.substring(0, 60)}${e.value.length > 60 ? '...' : ''}`,
                );
                ctx.dialog.open({
                    title: `Memories (${entries.length})`,
                    children: (
                        <scrollbox height={10}>
                            <text>{lines.join('\n')}</text>
                        </scrollbox>
                    ),
                });
            } catch {
                ctx.toast.show({
                    message: 'Failed to load memories',
                    variant: 'error',
                });
            }
        },
    },
    {
        name: 'audit',
        description: 'Show recent tool executions',
        value: '/audit',
        category: 'debug',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Audit Log',
                children: <AuditDialogContent />,
            });
        },
    },
    {
        name: 'branch',
        description: 'Fork conversation at current point',
        value: '/branch',
        category: 'session',
        action: (ctx) => {
            ctx.createBranch();
            ctx.toast.show({ message: 'Branch created', variant: 'success' });
        },
    },
    {
        name: 'confirmations',
        description: 'Toggle confirmation prompts for dangerous operations',
        value: '/confirmations',
        category: 'settings',
        action: (ctx) => {
            const enabled = toggleConfirmations();
            ctx.toast.show({
                message: `Confirmations ${enabled ? 'enabled' : 'disabled'}`,
                variant: 'success',
            });
        },
    },
    {
        name: 'files',
        description: 'Toggle file tree sidebar',
        value: '/files',
        category: 'settings',
        action: (ctx) => {
            ctx.toggleFileTree();
        },
    },
    {
        name: 'diff',
        description: 'Show changed files with git diffs',
        value: '/diff',
        category: 'settings',
        action: (ctx) => {
            ctx.openDiffMode();
        },
    },
    {
        name: 'commit',
        description: 'Open visual git staging & AI commit planner',
        value: '/commit',
        shortcut: 'Ctrl+G',
        category: 'settings',
        action: (ctx) => {
            if (!ctx.sessionId) {
                ctx.toast.show({
                    message: 'No active session',
                    variant: 'error',
                });
                return;
            }
            ctx.dialog.open({
                title: 'Git Commit Planner',
                children: (
                    <CommitDialogContent
                        sessionId={ctx.sessionId}
                        model={ctx.model}
                    />
                ),
            });
        },
    },
    {
        name: 'debug',
        description: 'Toggle debug logging on/off',
        value: '/debug',
        category: 'debug',
        action: (ctx) => {
            const enabled = debug.toggleEnabled();
            ctx.toast.show({
                message: `Debug logging ${enabled ? 'enabled' : 'disabled'}`,
                variant: 'success',
            });
        },
    },
    {
        name: 'reasoning',
        description: 'Toggle extended reasoning mode',
        value: '/reasoning',
        category: 'settings',
        action: (ctx) => {
            const enabled = toggleReasoning();
            ctx.toast.show({
                message: `Extended reasoning ${enabled ? 'enabled' : 'disabled'}`,
                variant: 'success',
            });
        },
    },
    {
        name: 'batch-toggle',
        description: 'Enable/disable request batching',
        value: '/batch-toggle',
        category: 'settings',
        action: (ctx) => {
            const enabled = batchManager.toggle();
            ctx.toast.show({
                message: `Batching ${enabled ? 'enabled' : 'disabled'}`,
                variant: 'success',
            });
        },
    },
    {
        name: 'queue',
        description: 'View and manage request queue',
        value: '/queue',
        category: 'debug',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Request Queue',
                children: <QueueDialogContent />,
            });
        },
    },
    {
        name: 'analytics',
        description: 'Show tool usage statistics',
        value: '/analytics',
        category: 'debug',
        action: async (ctx) => {
            const stats = await toolAnalytics.getStats();
            const lines = [
                `Total tool calls: ${stats.totalCalls}`,
                `Sessions: ${stats.sessions}`,
                `Daily average: ${stats.dailyAverage} calls`,
                '',
                'Top tools:',
            ];
            if (stats.topTools.length === 0) {
                lines.push('  No tool usage recorded yet.');
            } else {
                stats.topTools.forEach((tool) => {
                    lines.push(
                        `  ${tool.tool}: ${tool.count} calls, ${tool.avgTime}ms avg, ${tool.errorRate}% errors`,
                    );
                });
            }
            ctx.dialog.open({
                title: 'Tool Analytics',
                children: (
                    <scrollbox height={10}>
                        <text>{lines.join('\n')}</text>
                    </scrollbox>
                ),
            });
        },
    },
    {
        name: 'secret-scan',
        description: 'Scan files for secrets and API keys',
        value: '/secret-scan',
        category: 'debug',
        requiresBuildMode: true,
        action: async (ctx) => {
            try {
                ctx.toast.show({ message: 'Scanning for secrets...' });
                const { executeLocalTool } = await import('@/lib/local-tools');
                const result = await executeLocalTool(
                    'secretScan',
                    { path: '.', recursive: true },
                    'BUILD',
                );
                const data = result as {
                    count: number;
                    secrets: Array<{
                        file: string;
                        line: number;
                        type: string;
                        severity: string;
                    }>;
                };
                if (data.count === 0) {
                    ctx.toast.show({
                        message: 'No secrets found',
                        variant: 'success',
                    });
                } else {
                    const lines = data.secrets
                        .slice(0, 20)
                        .map(
                            (s: {
                                file: string;
                                line: number;
                                type: string;
                                severity: string;
                            }) =>
                                `${s.severity === 'high' ? 'HIGH' : s.severity === 'medium' ? 'MED' : 'LOW'} ${s.file}:${s.line} — ${s.type}`,
                        );
                    if (data.count > 20)
                        lines.push(`... and ${data.count - 20} more`);
                    ctx.dialog.open({
                        title: `Secret Scan: ${data.count} findings`,
                        children: (
                            <scrollbox height={10}>
                                <text>
                                    {lines.join('\n')}
                                    {
                                        '\n\nFalse positives are possible. Review each finding.'
                                    }
                                </text>
                            </scrollbox>
                        ),
                    });
                }
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : 'Scan failed';
                ctx.toast.show({ message, variant: 'error' });
            }
        },
    },
    {
        name: 'rename-symbol',
        description: 'Rename a variable/function across all files',
        value: '/rename-symbol',
        category: 'session',
        requiresBuildMode: true,
        action: async (ctx) => {
            try {
                const { RenameDialogContent } =
                    await import('@/components/dialog/rename-dialog');
                ctx.dialog.open({
                    title: 'Rename Symbol',
                    children: <RenameDialogContent />,
                });
            } catch {
                ctx.toast.show({
                    message: 'Rename dialog not available',
                    variant: 'error',
                });
            }
        },
    },
    {
        name: 'snapshots',
        description: 'View and manage test snapshots',
        value: '/snapshots',
        category: 'debug',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Snapshots',
                children: <SnapshotDialogContent />,
            });
        },
    },
    {
        name: 'orchestrate',
        description: 'View active orchestrations and task graphs',
        value: '/orchestrate',
        shortcut: 'Ctrl+O',
        category: 'session',
        action: (ctx) => {
            ctx.dialog.open({
                title: 'Orchestration',
                children: <OrchestrationDialogContent sessionId={ctx.sessionId} />,
            });
        },
    },
    {
        name: 'orchestrate-cancel',
        description: 'Cancel all active orchestrations',
        value: '/orchestrate-cancel',
        category: 'session',
        requiresBuildMode: true,
        action: (ctx) => {
            const active = orchestratorManager.getAll();
            if (active.length === 0) {
                ctx.toast.show({
                    message: 'No active orchestrations',
                    variant: 'info',
                });
                return;
            }
            for (const state of active) {
                for (const node of Object.values(state.graph.nodes)) {
                    if (
                        node.status === 'pending' ||
                        node.status === 'running'
                    ) {
                        cancelTask(state.graph, node.id);
                    }
                }
                state.graph.status = 'cancelled';
                state.graph.completedAt = Date.now();
                orchestratorManager.updateGraph(state.graph);
            }
            ctx.toast.show({
                message: `Cancelled ${active.length} orchestration(s)`,
                variant: 'success',
            });
        },
    },
];
