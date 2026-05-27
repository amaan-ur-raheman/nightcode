import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

import { DEFAULT_THEME, THEMES } from "@/theme";
import type { Theme, ThemeColors } from "@/theme";

const CONFIG_DIR = join(homedir(), ".nightcode");
const THEME_PREFERENCE_PATH = join(CONFIG_DIR, "preferences.json");

type ThemePreference = {
    themeName: string;
};

function getInitialTheme(): Theme {
    try {
        const preferences = JSON.parse(
            readFileSync(THEME_PREFERENCE_PATH, "utf-8")
        ) as Partial<ThemePreference>;

        const savedTheme = THEMES.find((theme) => theme.name === preferences.themeName);
        return savedTheme ?? DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
}

function persistTheme(theme: Theme) {
    try {
        mkdirSync(CONFIG_DIR, { recursive: true });
        writeFileSync(
            THEME_PREFERENCE_PATH,
            JSON.stringify({ themeName: theme.name } satisfies ThemePreference, null, 2),
            "utf-8"
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
        throw new Error("useTheme must be used within a ThemeProvider");
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
    )
}
