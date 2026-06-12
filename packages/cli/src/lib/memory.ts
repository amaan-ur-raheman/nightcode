import { readFile, writeFile, mkdir, open, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const MEMORY_DIR = join(homedir(), '.nightcode', 'memory');
const MEMORY_FILE = join(MEMORY_DIR, 'global.json');
const LOCK_FILE = `${MEMORY_FILE}.lock`;
const MAX_ENTRIES = 1000;

async function acquireLock(retries = 10, delay = 50): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            const handle = await open(LOCK_FILE, 'wx');
            await handle.close();
            return;
        } catch (err: any) {
            if (err.code === 'EEXIST') {
                if (i === retries - 1) {
                    throw new Error(
                        `Failed to acquire lock on memory file: ${err.message}`,
                    );
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw err;
        }
    }
}

async function releaseLock(): Promise<void> {
    try {
        await unlink(LOCK_FILE);
    } catch {
        // Ignore
    }
}

interface MemoryEntry {
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
    tags: string[];
}

class MemoryManager {
    private entries: Map<string, MemoryEntry> = new Map();
    private loaded = false;

    async load(): Promise<void> {
        if (this.loaded) return;

        try {
            await mkdir(MEMORY_DIR, { recursive: true });
            const content = await readFile(MEMORY_FILE, 'utf-8');
            const data = JSON.parse(content);
            for (const entry of data) {
                this.entries.set(entry.key, entry);
            }
        } catch {
            // No memory file yet
        }

        this.loaded = true;
    }

    private async save(): Promise<void> {
        await mkdir(MEMORY_DIR, { recursive: true });
        await acquireLock();
        try {
            const data = Array.from(this.entries.values());
            await writeFile(
                MEMORY_FILE,
                JSON.stringify(data, null, 2),
                'utf-8',
            );
        } finally {
            await releaseLock();
        }
    }

    async set(key: string, value: string, tags: string[] = []): Promise<void> {
        await this.load();

        const existing = this.entries.get(key);
        const entry: MemoryEntry = {
            key,
            value,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags,
        };

        this.entries.set(key, entry);

        // FIFO eviction if over limit — remove oldest entries
        while (this.entries.size > MAX_ENTRIES) {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            for (const [k, entry] of this.entries) {
                const t = new Date(entry.updatedAt).getTime();
                if (t < oldestTime) {
                    oldestTime = t;
                    oldestKey = k;
                }
            }
            if (oldestKey) this.entries.delete(oldestKey);
            else break;
        }

        await this.save();
    }

    async get(key: string): Promise<string | null> {
        await this.load();
        return this.entries.get(key)?.value ?? null;
    }

    async delete(key: string): Promise<boolean> {
        await this.load();
        const deleted = this.entries.delete(key);
        if (deleted) await this.save();
        return deleted;
    }

    async list(filter?: { tag?: string }): Promise<MemoryEntry[]> {
        await this.load();
        let entries = Array.from(this.entries.values());

        const tag = filter?.tag;
        if (tag) {
            entries = entries.filter((e) => e.tags.includes(tag));
        }

        return entries.sort(
            (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
        );
    }

    async search(query: string): Promise<MemoryEntry[]> {
        await this.load();
        const lower = query.toLowerCase();
        return Array.from(this.entries.values()).filter(
            (e) =>
                e.key.toLowerCase().includes(lower) ||
                e.value.toLowerCase().includes(lower),
        );
    }
}

export const memory = new MemoryManager();
