import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

const UNDO_DIR = join(homedir(), '.nightcode', 'undo');

interface UndoEntry {
    id: string;
    filePath: string;
    backupPath: string;
    timestamp: number;
    tool: string;
    description: string;
}

class UndoManager {
    private stack: UndoEntry[] = [];
    private maxEntries = 50;

    async backup(
        filePath: string,
        tool: string,
        description: string,
    ): Promise<string> {
        const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const backupPath = join(UNDO_DIR, `${id}.bak`);

        await mkdir(dirname(backupPath), { recursive: true });

        try {
            const content = await readFile(filePath, 'utf-8');
            await writeFile(backupPath, content, 'utf-8');
        } catch {
            // File doesn't exist yet — this is a new file creation
            await writeFile(backupPath, '', 'utf-8');
        }

        const entry: UndoEntry = {
            id,
            filePath,
            backupPath,
            timestamp: Date.now(),
            tool,
            description,
        };
        this.stack.push(entry);

        if (this.stack.length > this.maxEntries) {
            const old = this.stack.shift()!;
            try {
                await unlink(old.backupPath);
            } catch {
                // ignore cleanup errors
            }
        }

        return id;
    }

    async undoLast(): Promise<{ filePath: string; restored: boolean } | null> {
        const entry = this.stack.pop();
        if (!entry) return null;

        try {
            const backup = await readFile(entry.backupPath, 'utf-8');
            await writeFile(entry.filePath, backup, 'utf-8');
            try {
                await unlink(entry.backupPath);
            } catch {
                // ignore cleanup errors
            }
            return { filePath: entry.filePath, restored: true };
        } catch {
            return { filePath: entry.filePath, restored: false };
        }
    }

    getHistory(): UndoEntry[] {
        return [...this.stack].reverse();
    }

    async undoAll(): Promise<number> {
        let count = 0;
        while (this.stack.length > 0) {
            const result = await this.undoLast();
            if (result?.restored) count++;
        }
        return count;
    }

    reset(): void {
        this.stack = [];
    }
}

export const undoManager = new UndoManager();
