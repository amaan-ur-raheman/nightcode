import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

import { THEMES, DEFAULT_THEME } from '@/theme';
import type { Theme, ThemeColors, CustomTheme } from '@/theme';
import { debug } from '@/lib/debug';

const CUSTOM_THEMES_PATH = join(homedir(), '.nightcode', 'custom-themes.json');

type CustomThemeStore = {
    themes: CustomTheme[];
};

class ThemeManager {
    private customThemes: CustomTheme[] = [];
    private loaded = false;
    private loadingPromise: Promise<void> | null = null;

    async load(): Promise<void> {
        if (this.loaded) return;
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = (async () => {
            try {
                const content = await readFile(CUSTOM_THEMES_PATH, 'utf-8');
                const store: CustomThemeStore = JSON.parse(content);
                this.customThemes = store.themes || [];
                this.loaded = true;
            } catch (err) {
                this.loadingPromise = null;
                // File not found on first run — fall back to empty themes
                if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
                    this.customThemes = [];
                    this.loaded = true;
                    return;
                }
                throw err;
            }
            this.loadingPromise = null;
        })();

        return this.loadingPromise;
    }

    private async save(): Promise<void> {
        const store: CustomThemeStore = { themes: this.customThemes };
        await mkdir(join(homedir(), '.nightcode'), { recursive: true });
        await writeFile(
            CUSTOM_THEMES_PATH,
            JSON.stringify(store, null, 2),
            'utf-8',
        );
    }

    async createTheme(
        name: string,
        baseColors: Partial<ThemeColors>,
    ): Promise<CustomTheme> {
        await this.load();

        if (this.customThemes.some((t) => t.name === name)) {
            throw new Error(`Theme with name '${name}' already exists`);
        }

        const colors: ThemeColors = {
            ...DEFAULT_THEME.colors,
            ...baseColors,
        };

        const theme: CustomTheme = {
            name,
            colors,
            createdAt: new Date().toISOString(),
        };

        this.customThemes.push(theme);
        await this.save();

        debug.log('theme', `Created custom theme: ${name}`);
        return theme;
    }

    async updateTheme(
        name: string,
        colors: Partial<ThemeColors>,
    ): Promise<boolean> {
        await this.load();

        const theme = this.customThemes.find((t) => t.name === name);
        if (!theme) return false;

        theme.colors = { ...theme.colors, ...colors };
        await this.save();

        debug.log('theme', `Updated custom theme: ${name}`);
        return true;
    }

    async deleteTheme(name: string): Promise<boolean> {
        await this.load();

        const index = this.customThemes.findIndex((t) => t.name === name);
        if (index === -1) return false;

        this.customThemes.splice(index, 1);
        await this.save();

        debug.log('theme', `Deleted custom theme: ${name}`);
        return true;
    }

    async getTheme(name: string): Promise<CustomTheme | undefined> {
        await this.load();
        return this.customThemes.find((t) => t.name === name);
    }

    async getAllThemes(): Promise<Theme[]> {
        await this.load();
        const customAsTheme: Theme[] = this.customThemes.map((t) => ({
            name: t.name,
            colors: t.colors,
        }));
        return [...THEMES, ...customAsTheme];
    }

    async listThemes(): Promise<
        { name: string; type: 'builtin' | 'custom' }[]
    > {
        await this.load();

        const builtin = THEMES.map((t) => ({
            name: t.name,
            type: 'builtin' as const,
        }));

        const custom = this.customThemes.map((t) => ({
            name: t.name,
            type: 'custom' as const,
        }));

        return [...builtin, ...custom];
    }

    async getThemeColors(name: string): Promise<ThemeColors | undefined> {
        await this.load();
        const builtin = THEMES.find((t) => t.name === name);
        if (builtin) return builtin.colors;

        const custom = this.customThemes.find((t) => t.name === name);
        if (custom) return custom.colors;

        return undefined;
    }

    async isCustomTheme(name: string): Promise<boolean> {
        await this.load();
        return this.customThemes.some((t) => t.name === name);
    }

    async isThemeNameTaken(name: string): Promise<boolean> {
        await this.load();
        return (
            THEMES.some((t) => t.name === name) ||
            this.customThemes.some((t) => t.name === name)
        );
    }
}

export const themeManager = new ThemeManager();
