import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { debug } from './debug';

const SNAPSHOTS_DIR = join(homedir(), '.nightcode', 'snapshots');

export interface SnapshotEntry {
    name: string;
    hash: string;
    value: string;
    createdAt: string;
}

class SnapshotManager {
    private snapshots: Map<string, SnapshotEntry> = new Map();
    private loaded = false;

    async load(): Promise<void> {
        if (this.loaded) return;

        try {
            const content = await readFile(
                join(SNAPSHOTS_DIR, 'snapshots.json'),
                'utf-8',
            );
            const entries: SnapshotEntry[] = JSON.parse(content);
            entries.forEach((entry) => {
                this.snapshots.set(entry.name, entry);
            });
        } catch {
            // No snapshots yet
        }

        this.loaded = true;
    }

    async save(): Promise<void> {
        await mkdir(SNAPSHOTS_DIR, { recursive: true });
        const entries = Array.from(this.snapshots.values());
        const targetPath = join(SNAPSHOTS_DIR, 'snapshots.json');
        const tmpPath = `${targetPath}.tmp.${Date.now()}`;

        // Atomic write: write to temp file, then rename (atomic on POSIX)
        try {
            await writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
            await rename(tmpPath, targetPath);
        } catch (err) {
            // Clean up temp file on failure
            try {
                await unlink(tmpPath);
            } catch {
                // ignore cleanup errors
            }
            throw err;
        }
    }

    async match(
        name: string,
        value: string,
    ): Promise<{ match: boolean; stored?: string }> {
        await this.load();

        const stored = this.snapshots.get(name);

        if (!stored) {
            await this.set(name, value);
            return { match: true };
        }

        const hash = this.hash(value);
        const match = stored.hash === hash;

        if (!match) {
            debug.log('snapshot', `Snapshot mismatch for ${name}`);
            debug.log(
                'snapshot',
                `Expected: length=${stored.value.length}, hash=${stored.hash.substring(0, 8)}...`,
            );
            debug.log(
                'snapshot',
                `Got: length=${value.length}, hash=${hash.substring(0, 8)}...`,
            );
        }

        return { match, stored: stored.value };
    }

    async set(name: string, value: string): Promise<void> {
        await this.load();

        this.snapshots.set(name, {
            name,
            hash: this.hash(value),
            value,
            createdAt: new Date().toISOString(),
        });

        await this.save();
        debug.log('snapshot', `Updated snapshot: ${name}`);
    }

    async delete(name: string): Promise<boolean> {
        await this.load();

        const existed = this.snapshots.delete(name);

        if (existed) {
            await this.save();
            debug.log('snapshot', `Deleted snapshot: ${name}`);
        }

        return existed;
    }

    async list(): Promise<SnapshotEntry[]> {
        await this.load();
        return Array.from(this.snapshots.values());
    }

    async clear(): Promise<void> {
        this.snapshots.clear();
        await this.save();
        debug.log('snapshot', 'Cleared all snapshots');
    }

    reset(): void {
        this.snapshots.clear();
        this.loaded = false;
    }

    private hash(value: string): string {
        return createHash('sha256').update(value).digest('hex');
    }
}

export const snapshotManager = new SnapshotManager();
