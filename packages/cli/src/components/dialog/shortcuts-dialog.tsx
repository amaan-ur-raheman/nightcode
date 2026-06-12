import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

export function ShortcutsDialogContent() {
    const { colors } = useTheme();

    const shortcuts = [
        { key: 'Tab', desc: 'Toggle Build/Plan mode' },
        { key: 'Ctrl+P', desc: 'Open command palette' },
        { key: 'Ctrl+A/I', desc: 'Attach image from path' },
        { key: 'Ctrl+C', desc: 'Copy selection' },
        { key: 'Ctrl+V', desc: 'Paste (auto-attaches image paths)' },
        { key: 'Esc', desc: 'Interrupt reply / Close dialog' },
        { key: 'w', desc: 'Toggle word wrap' },
        { key: 'Ctrl+R', desc: 'Retry last response' },
        { key: 'Ctrl+?', desc: 'Show this shortcuts panel' },
        { key: '↑/↓', desc: 'Navigate input history' },
        { key: '@', desc: 'Mention a file' },
        { key: '/help', desc: 'Show all commands' },
    ];

    return (
        <box flexDirection="column" gap={0} paddingX={1}>
            {shortcuts.map((s) => (
                <box key={s.key} flexDirection="row" gap={1}>
                    <text fg={colors.info} width={12}>
                        {s.key}
                    </text>
                    <text attributes={TextAttributes.DIM}>{s.desc}</text>
                </box>
            ))}
            <box marginTop={1}>
                <text attributes={TextAttributes.DIM}>Press Esc to close</text>
            </box>
        </box>
    );
}
