import { useCallback, useEffect, useRef, useState } from 'react';

import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';

import { THEMES } from '@/theme';
import type { Theme, ThemeColors } from '@/theme';
import { useDialog } from '@/providers/dialog';
import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { themeManager } from '@/lib/theme-manager';

import { DialogSearchList } from '@/components/dialog-search-list';

type View = 'list' | 'create' | 'delete';

export function ThemeDialogContent({
    defaultView = 'list',
}: { defaultView?: View } = {}) {
    const dialog = useDialog();
    const { setTheme, currentTheme, colors } = useTheme();
    const originalThemeRef = useRef(currentTheme);
    const confirmedRef = useRef(false);
    const [view, setView] = useState<View>(defaultView);
    const [customThemes, setCustomThemes] = useState<Theme[]>([]);
    const [allThemes, setAllThemes] = useState<Theme[]>(THEMES);

    // Load custom themes on mount
    useEffect(() => {
        themeManager.load().then(async () => {
            const custom = await themeManager.getAllThemes();
            setCustomThemes(
                custom.filter((t) => !THEMES.some((b) => b.name === t.name)),
            );
            setAllThemes(custom);
        });
    }, []);

    // Revert to original theme if the user dismisses the dialog without confirming
    useEffect(() => {
        return () => {
            if (!confirmedRef.current) {
                setTheme(originalThemeRef.current);
            }
        };
    }, [setTheme]);

    const handleSelect = useCallback(
        (theme: Theme) => {
            confirmedRef.current = true;
            setTheme(theme);
            dialog.close();
        },
        [setTheme, dialog],
    );

    const handleHighlight = useCallback(
        (theme: Theme) => {
            setTheme(theme);
        },
        [setTheme],
    );

    if (view === 'create') {
        return (
            <CreateThemeView
                onBack={() => setView('list')}
                onCreated={() => {
                    themeManager.load().then(async () => {
                        const custom = await themeManager.getAllThemes();
                        setCustomThemes(
                            custom.filter(
                                (t) => !THEMES.some((b) => b.name === t.name),
                            ),
                        );
                        setAllThemes(custom);
                    });
                    setView('list');
                }}
            />
        );
    }

    if (view === 'delete') {
        return (
            <DeleteThemeView
                customThemes={customThemes}
                onBack={() => setView('list')}
                onDeleted={() => {
                    themeManager.load().then(async () => {
                        const custom = await themeManager.getAllThemes();
                        setCustomThemes(
                            custom.filter(
                                (t) => !THEMES.some((b) => b.name === t.name),
                            ),
                        );
                        setAllThemes(custom);
                    });
                    setView('list');
                }}
            />
        );
    }

    return (
        <ThemeListView
            themes={allThemes}
            originalTheme={originalThemeRef.current}
            onSelect={handleSelect}
            onHighlight={handleHighlight}
            onCreate={() => setView('create')}
            onDelete={() => setView('delete')}
            hasCustomThemes={customThemes.length > 0}
        />
    );
}

function ThemeListView({
    themes,
    originalTheme,
    onSelect,
    onHighlight,
    onCreate,
    onDelete,
    hasCustomThemes,
}: {
    themes: Theme[];
    originalTheme: Theme;
    onSelect: (theme: Theme) => void;
    onHighlight: (theme: Theme) => void;
    onCreate: () => void;
    onDelete: () => void;
    hasCustomThemes: boolean;
}) {
    const { isTopLayer } = useKeyboardLayer();
    const { colors } = useTheme();
    const [actionIndex, setActionIndex] = useState(0);
    const actions = [
        { label: 'Create Custom Theme', key: 'create' as const },
        ...(hasCustomThemes
            ? [{ label: 'Delete Custom Theme', key: 'delete' as const }]
            : []),
    ];

    useKeyboard((key) => {
        if (!isTopLayer('dialog')) return;
        if (key.name === 'tab') {
            setActionIndex((i) => (i + 1) % actions.length);
        }
    });

    return (
        <box flexDirection="column" gap={1}>
            <DialogSearchList
                items={themes}
                onSelect={onSelect}
                onHighlight={onHighlight}
                filterFn={(theme, query) =>
                    theme.name.toLowerCase().includes(query.toLowerCase())
                }
                renderItem={(theme, isSelected) => (
                    <text
                        selectable={false}
                        fg={isSelected ? 'black' : 'white'}
                    >
                        {theme.name === originalTheme.name
                            ? '\u0020\u2022\u0020'
                            : '\u0020\u0020\u0020'}
                        {theme.name}
                    </text>
                )}
                getKey={(theme) => theme.name}
                placeholder="Search themes"
                emptyText="No matching themes"
            />
            <box flexDirection="row" gap={1}>
                {actions.map((action, i) => (
                    <text
                        key={action.key}
                        fg={i === actionIndex ? colors.selection : colors.text}
                        {...({
                            onClick:
                                action.key === 'create' ? onCreate : onDelete,
                        } as any)}
                    >
                        {action.label}
                    </text>
                ))}
            </box>
        </box>
    );
}

function CreateThemeView({
    onBack,
    onCreated,
}: {
    onBack: () => void;
    onCreated: () => void;
}) {
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<any>(null);

    useKeyboard((key) => {
        if (!isTopLayer('dialog')) return;
        if (key.name === 'escape') {
            onBack();
        } else if (key.name === 'return' || key.name === 'enter') {
            handleCreate();
        } else if (key.name === 'backspace') {
            setName((n) => n.slice(0, -1));
            setError(null);
        } else if (key.name === 'space') {
            setName((n) => n + ' ');
        } else if (
            key.sequence &&
            key.sequence.length === 1 &&
            /[a-zA-Z0-9 -_]/.test(key.sequence)
        ) {
            setName((n) => n + key.sequence);
            setError(null);
        }
    });

    const handleCreate = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            setError('Theme name cannot be empty');
            return;
        }

        if (await themeManager.isThemeNameTaken(trimmed)) {
            setError('A theme with this name already exists');
            return;
        }

        await themeManager.createTheme(trimmed, {});
        onCreated();
    };

    return (
        <box flexDirection="column" gap={1} padding={1}>
            <text fg={colors.primary} attributes={TextAttributes.BOLD}>
                Create Custom Theme
            </text>
            <text fg={colors.text}>Base: {colors.background}</text>
            <box flexDirection="row" gap={1}>
                <text fg={colors.text}>Name: </text>
                <text fg={colors.primary}>{name}_</text>
            </box>
            {error && <text fg={colors.error}>{error}</text>}
            <box flexDirection="row" gap={2}>
                <text
                    fg={colors.primary}
                    {...({ onClick: handleCreate } as any)}
                >
                    [Create]
                </text>
                <text fg={colors.text} {...({ onClick: onBack } as any)}>
                    [Cancel]
                </text>
            </box>
            <text fg={colors.text} attributes={TextAttributes.DIM}>
                Creates a copy of the current theme. Edit colors later via
                themes.json
            </text>
        </box>
    );
}

function DeleteThemeView({
    customThemes,
    onBack,
    onDeleted,
}: {
    customThemes: Theme[];
    onBack: () => void;
    onDeleted: () => void;
}) {
    const { setTheme } = useTheme();
    const [selectedIndex, setSelectedIndex] = useState(0);

    const handleDelete = async (theme: Theme) => {
        await themeManager.deleteTheme(theme.name);
        onDeleted();
    };

    return (
        <DialogSearchList
            items={customThemes}
            onSelect={handleDelete}
            filterFn={(theme, query) =>
                theme.name.toLowerCase().includes(query.toLowerCase())
            }
            renderItem={(theme, isSelected) => (
                <text selectable={false} fg={isSelected ? 'black' : 'white'}>
                    {'\u0020\u0020\u0020'}
                    {theme.name}
                    {isSelected ? ' (press Enter to delete)' : ''}
                </text>
            )}
            getKey={(theme) => theme.name}
            placeholder="Search custom themes to delete"
            emptyText="No custom themes to delete"
        />
    );
}
