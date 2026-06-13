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

export interface MemoryEntry {
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
    tags: string[];
    /** Number of times this entry has been accessed via get/search */
    accessCount: number;
    /** ISO timestamp after which this entry is considered expired. null = never expires. */
    expiresAt?: string;
}

export interface MemoryStats {
    totalEntries: number;
    totalTags: string[];
    oldestEntry?: string;
    newestEntry?: string;
    expiredEntries: number;
    mostAccessed?: { key: string; accessCount: number };
}

class MemoryManager {
    private entries: Map<string, MemoryEntry> = new Map();
    private loaded = false;
    private _dirty = false;
    private saveTimeout: NodeJS.Timeout | null = null;

    async load(): Promise<void> {
        if (this.loaded) return;

        try {
            await mkdir(MEMORY_DIR, { recursive: true });
            const content = await readFile(MEMORY_FILE, 'utf-8');
            const data = JSON.parse(content);
            for (const entry of data) {
                // Normalize old entries that lack new fields
                entry.accessCount = entry.accessCount ?? 0;
                this.entries.set(entry.key, entry);
            }
        } catch {
            // No memory file yet
        }

        this.loaded = true;
    }

    private async save(): Promise<void> {
        this._dirty = false;
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
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

    private scheduleSaveDebounced(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveIfDirty().catch(() => {});
        }, 1000);
    }

    async saveIfDirty(): Promise<void> {
        if (!this._dirty) return;
        this._dirty = false;
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        await this.save();
    }

    async set(
        key: string,
        value: string,
        tags: string[] = [],
        ttlMs?: number,
    ): Promise<void> {
        await this.load();

        const existing = this.entries.get(key);
        const entry: MemoryEntry = {
            key,
            value,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags,
            accessCount: existing?.accessCount ?? 0,
            expiresAt: ttlMs
                ? new Date(Date.now() + ttlMs).toISOString()
                : existing?.expiresAt,
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
        await this.evictExpired();
        const entry = this.entries.get(key);
        if (!entry) return null;
        entry.accessCount = (entry.accessCount ?? 0) + 1;
        this._dirty = true;
        this.scheduleSaveDebounced();
        return entry.value;
    }

    async delete(key: string): Promise<boolean> {
        await this.load();
        const deleted = this.entries.delete(key);
        if (deleted) await this.save();
        return deleted;
    }

    async list(filter?: { tag?: string }): Promise<MemoryEntry[]> {
        await this.load();
        await this.evictExpired();
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
        await this.evictExpired();
        const lower = query.toLowerCase();
        const results: MemoryEntry[] = [];
        for (const entry of this.entries.values()) {
            if (
                entry.key.toLowerCase().includes(lower) ||
                entry.value.toLowerCase().includes(lower)
            ) {
                entry.accessCount = (entry.accessCount ?? 0) + 1;
                results.push(entry);
            }
        }
        if (results.length > 0) {
            this._dirty = true;
            this.scheduleSaveDebounced();
        }
        return results;
    }

    /**
     * Fuzzy search using Levenshtein distance.
     * First checks substring containment (distance 0), then falls back
     * to edit distance on individual tokens split from the key and value.
     */
    async fuzzySearch(query: string, maxDist = 2): Promise<MemoryEntry[]> {
        await this.load();
        await this.evictExpired();
        const lower = query.toLowerCase();
        const results: { entry: MemoryEntry; dist: number }[] = [];

        for (const entry of this.entries.values()) {
            const keyLower = entry.key.toLowerCase();
            const valLower = entry.value.toLowerCase();

            // Substring containment is distance 0
            if (keyLower.includes(lower) || valLower.includes(lower)) {
                entry.accessCount = (entry.accessCount ?? 0) + 1;
                results.push({ entry, dist: 0 });
                continue;
            }

            // Split key into tokens and compute edit distance against each
            const keyTokens = keyLower.split(/[\/\-_.:]/g).filter(Boolean);
            const valTokens = valLower.split(/[\/\-_.:\s]/g).filter(Boolean);
            let bestDist = Infinity;
            for (const t of keyTokens) {
                bestDist = Math.min(bestDist, editDistance(lower, t));
            }
            for (const t of valTokens) {
                bestDist = Math.min(
                    bestDist,
                    editDistance(lower, t.slice(0, 50)),
                );
            }

            if (bestDist <= maxDist) {
                entry.accessCount = (entry.accessCount ?? 0) + 1;
                results.push({ entry, dist: bestDist });
            }
        }

        if (results.length > 0) {
            this._dirty = true;
            this.scheduleSaveDebounced();
        }
        return results.sort((a, b) => a.dist - b.dist).map((r) => r.entry);
    }

    /**
     * Get memory statistics.
     */
    async stats(): Promise<MemoryStats> {
        await this.load();
        await this.evictExpired();
        const entries = Array.from(this.entries.values());
        if (entries.length === 0) {
            return { totalEntries: 0, totalTags: [], expiredEntries: 0 };
        }

        const tagSet = new Set<string>();
        let oldest = entries[0]!;
        let newest = entries[0]!;
        let mostAccessed = entries[0]!;

        for (const e of entries) {
            for (const t of e.tags) tagSet.add(t);
            if (
                new Date(e.createdAt).getTime() <
                new Date(oldest.createdAt).getTime()
            )
                oldest = e;
            if (
                new Date(e.createdAt).getTime() >
                new Date(newest.createdAt).getTime()
            )
                newest = e;
            if (e.accessCount > mostAccessed.accessCount) mostAccessed = e;
        }

        return {
            totalEntries: entries.length,
            totalTags: [...tagSet].sort(),
            oldestEntry: oldest.key,
            newestEntry: newest.key,
            expiredEntries: 0, // already evicted by evictExpired() above
            mostAccessed:
                mostAccessed.accessCount > 0
                    ? {
                          key: mostAccessed.key,
                          accessCount: mostAccessed.accessCount,
                      }
                    : undefined,
        };
    }

    /**
     * Remove expired entries based on TTL. Persists removal to disk.
     * Wrapped in try/catch so failures don't break read operations.
     */
    private async evictExpired(): Promise<void> {
        let removed = false;
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) {
                this.entries.delete(key);
                removed = true;
            }
        }
        if (removed) {
            try {
                await this.save();
            } catch {
                // Best-effort: don't break reads if disk save fails
            }
        }
    }
}

/**
 * Levenshtein edit distance between two strings.
 */
function editDistance(a: string, b: string): number {
    const MAX_LEN = 500;
    if (a.length > MAX_LEN) a = a.slice(0, MAX_LEN);
    if (b.length > MAX_LEN) b = b.slice(0, MAX_LEN);
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
        Array(n + 1).fill(0),
    );
    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i]![j] = Math.min(
                dp[i - 1]![j]! + 1,
                dp[i]![j - 1]! + 1,
                dp[i - 1]![j - 1]! + cost,
            );
        }
    }
    return dp[m]![n]!;
}

export const memory = new MemoryManager();

process.on('beforeExit', () => {
    memory.saveIfDirty().catch(() => {});
});

process.on('exit', () => {
    memory.saveIfDirty().catch(() => {});
});

process.on('SIGINT', () => {
    memory
        .saveIfDirty()
        .catch(() => {})
        .finally(() => {
            if (process.listenerCount('SIGINT') <= 1) {
                process.exit(0);
            }
        });
});
