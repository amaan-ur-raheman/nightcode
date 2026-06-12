import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

import { DEFAULT_THEME, THEMES } from '@/theme';
import type { Theme, ThemeColors, CustomTheme } from '@/theme';

const CONFIG_DIR = join(homedir(), '.nightcode');
const THEME_PREFERENCE_PATH = join(CONFIG_DIR, 'preferences.json');
const CUSTOM_THEMES_PATH = join(CONFIG_DIR, 'custom-themes.json');

type ThemePreference = {
    themeName: string;
};

function loadCustomThemes(): CustomTheme[] {
    try {
        if (!existsSync(CUSTOM_THEMES_PATH)) return [];
        const content = readFileSync(CUSTOM_THEMES_PATH, 'utf-8');
        const store = JSON.parse(content);
        return store.themes || [];
    } catch {
        return [];
    }
}

function resolveTheme(name: string): Theme {
    const builtin = THEMES.find((t) => t.name === name);
    if (builtin) return builtin;

    const customThemes = loadCustomThemes();
    const custom = customThemes.find((t) => t.name === name);
    if (custom) {
        return { name: custom.name, colors: custom.colors };
    }

    return DEFAULT_THEME;
}

function getInitialTheme(): Theme {
    try {
        const preferences = JSON.parse(
            readFileSync(THEME_PREFERENCE_PATH, 'utf-8'),
        ) as Partial<ThemePreference>;

        if (preferences.themeName) {
            return resolveTheme(preferences.themeName);
        }
        return DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
}

function persistTheme(theme: Theme) {
    try {
        mkdirSync(CONFIG_DIR, { recursive: true });
        writeFileSync(
            THEME_PREFERENCE_PATH,
            JSON.stringify(
                { themeName: theme.name } satisfies ThemePreference,
                null,
                2,
            ),
            'utf-8',
        );
    } catch {
        // Ignore preference write failures so theme switching still works for this session.
    }
}

type ThemeContextValue = {
    colors: ThemeColors;
    currentTheme: Theme;
    setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
    const value = useContext(ThemeContext);
    if (!value) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }

    return value;
}

type ThemeProviderProps = {
    children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [currentTheme, setCurrentTheme] = useState<Theme>(getInitialTheme);

    const setTheme = useCallback((theme: Theme) => {
        setCurrentTheme(theme);
        persistTheme(theme);
    }, []);

    return (
        <ThemeContext.Provider
            value={{ colors: currentTheme.colors, currentTheme, setTheme }}
        >
            {children}
        </ThemeContext.Provider>
    );
}
