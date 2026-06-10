import { useState, useEffect } from "react";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const RECENT_DIR = join(homedir(), ".nightcode");
const RECENT_FILE = join(RECENT_DIR, "recent-commands.json");
const MAX_RECENT = 10;

class RecentCommandsManager {
    private recent: string[] = [];
    private loaded = false;

    async load(): Promise<void> {
        if (this.loaded) return;

        try {
            const content = await readFile(RECENT_FILE, "utf-8");
            this.recent = JSON.parse(content);
        } catch {
            this.recent = [];
        }

        this.loaded = true;
    }

    async add(commandId: string): Promise<void> {
        this.recent = [commandId, ...this.recent.filter(id => id !== commandId)].slice(0, MAX_RECENT);
        await this.save();
    }

    getIds(): string[] {
        return this.recent;
    }

    private async save(): Promise<void> {
        try {
            await mkdir(RECENT_DIR, { recursive: true });
            await writeFile(RECENT_FILE, JSON.stringify(this.recent), "utf-8");
        } catch {
            // Ignore write errors silently
        }
    }
}

export const recentCommands = new RecentCommandsManager();

export function useRecentCommands() {
    const [, forceUpdate] = useState({});

    useEffect(() => {
        recentCommands.load().then(() => forceUpdate({}));
    }, []);

    return recentCommands;
}
