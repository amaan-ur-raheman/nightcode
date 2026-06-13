import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

export function HelpDialogContent() {
    const { colors } = useTheme();

    const commands = [
        { cmd: '/help', desc: 'Show this help message' },
        { cmd: '/new', desc: 'Start a new conversation' },
        { cmd: '/clear', desc: 'Clear chat history' },
        { cmd: '/agents', desc: 'Switch agents' },
        { cmd: '/models', desc: 'Select AI model' },
        { cmd: '/sessions', desc: 'Browse past sessions' },
        { cmd: '/theme', desc: 'Change the theme' },
        { cmd: '/skills', desc: 'Use a prompt skill' },
        { cmd: '/mcp', desc: 'View connected MCP servers' },
        { cmd: '/mcp-scope', desc: 'Restrict active MCP servers' },
        { cmd: '/login', desc: 'Sign in with your browser' },
        { cmd: '/logout', desc: 'Sign out of your account' },
        { cmd: '/upgrade', desc: 'Buy more credits' },
        { cmd: '/usage', desc: 'Open billing portal' },
        { cmd: '/export', desc: 'Export current session' },
        { cmd: '/import', desc: 'Import a session' },
        { cmd: '/exit', desc: 'Quit the application' },
        { cmd: '/undo', desc: 'Undo last file change' },
        { cmd: '/memory', desc: 'Show stored memories' },
        { cmd: '/branch', desc: 'Fork conversation' },
        { cmd: '/files', desc: 'Toggle file tree' },
        { cmd: '/diff', desc: 'Show changed files' },
        { cmd: '/snapshots', desc: 'View test snapshots' },
        { cmd: '/queue', desc: 'View request queue' },
        { cmd: '/analytics', desc: 'Tool usage stats' },
        { cmd: '/secret-scan', desc: 'Scan for secrets' },
        { cmd: '/rename-symbol', desc: 'Rename across files' },
        { cmd: '/orchestrate', desc: 'View orchestrations' },
        { cmd: '/confirmations', desc: 'Toggle confirmations' },
        { cmd: '/reasoning', desc: 'Toggle reasoning mode' },
        { cmd: '/batch-toggle', desc: 'Toggle batching' },
        { cmd: '/debug', desc: 'Toggle debug logging' },
        { cmd: '/audit', desc: 'Show audit log' },
    ];

    const shortcuts = [
        { key: 'Tab', desc: 'Toggle Build/Plan mode' },
        { key: 'Ctrl+X', desc: 'Open command palette' },
        { key: 'Ctrl+C', desc: 'Copy selection' },
        { key: 'Ctrl+V', desc: 'Paste from clipboard' },
        { key: 'Esc', desc: 'Interrupt reply / Close dialog' },
        { key: 'w', desc: 'Toggle word wrap' },
        { key: 'Ctrl+R', desc: 'Retry last response' },
        { key: '↑/↓', desc: 'Navigate input history' },
        { key: '@', desc: 'Mention a file' },
        { key: 'Ctrl+T', desc: 'Toggle file tree' },
        { key: 'Ctrl+O', desc: 'View orchestrations' },
        { key: 'Ctrl+H', desc: 'View visual playback timeline' },
        { key: 'Ctrl+Z', desc: 'Undo last change' },
        { key: '[/]', desc: 'Resize file tree' },
        { key: 'j/k', desc: 'Navigate file tree' },
    ];

    return (
        <box flexDirection="column" gap={1} paddingX={1}>
            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                    Commands
                </text>
                <text attributes={TextAttributes.DIM}>{'─'.repeat(36)}</text>
                {commands.map((c) => (
                    <box key={c.cmd} flexDirection="row" gap={1}>
                        <text fg={colors.primary} width={16}>
                            {c.cmd}
                        </text>
                        <text attributes={TextAttributes.DIM}>{c.desc}</text>
                    </box>
                ))}
            </box>

            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                    Keyboard Shortcuts
                </text>
                <text attributes={TextAttributes.DIM}>{'─'.repeat(36)}</text>
                {shortcuts.map((s) => (
                    <box key={s.key} flexDirection="row" gap={1}>
                        <text fg={colors.info} width={12}>
                            {s.key}
                        </text>
                        <text attributes={TextAttributes.DIM}>{s.desc}</text>
                    </box>
                ))}
            </box>

            <box marginTop={1}>
                <text attributes={TextAttributes.DIM}>Press Esc to close</text>
            </box>
        </box>
    );
}
