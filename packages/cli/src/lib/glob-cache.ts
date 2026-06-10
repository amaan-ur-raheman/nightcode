import { stat, readdir } from "fs/promises";
import { join, relative } from "path";
import { IGNORE } from "./tools/utils";

interface CacheEntry {
    rootDir: string;
    mtime: number;
    entries: string[];
}

class GlobCache {
    private cache: Map<string, CacheEntry> = new Map();
    private ttl = 5000;
    private maxEntries = 1000;
    private maxEntrySize = 10000;
    private hits = 0;
    private misses = 0;

    async getCachedGlob(pattern: string, rootDir: string): Promise<string[]> {
        const cacheKey = `${rootDir}:${pattern}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.mtime < this.ttl) {
            this.hits++;
            return cached.entries;
        }

        this.misses++;
        const entries = await this.scanGlob(pattern, rootDir);

        // Cap entry size to prevent unbounded memory growth
        const trimmed = entries.length > this.maxEntrySize
            ? entries.slice(0, this.maxEntrySize)
            : entries;

        if (this.cache.size >= this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) this.cache.delete(oldestKey);
        }

        this.cache.set(cacheKey, {
            rootDir,
            mtime: Date.now(),
            entries: trimmed,
        });

        return trimmed;
    }

    private async scanGlob(pattern: string, rootDir: string): Promise<string[]> {
        const entries: string[] = [];
        const regex = this.globToRegex(pattern);

        const scan = async (dir: string) => {
            try {
                const items = await readdir(dir);

                for (const item of items) {
                    if (item.startsWith(".") || IGNORE.has(item)) continue;

                    const fullPath = join(dir, item);
                    const relativePath = relative(rootDir, fullPath);

                    let stats: import("fs").Stats;
                    try {
                        stats = await stat(fullPath);
                    } catch {
                        continue;
                    }

                    if (stats.isFile() && regex.test(relativePath)) {
                        entries.push(relativePath);
                    }

                    if (stats.isDirectory()) {
                        await scan(fullPath);
                    }
                }
            } catch {
                // Skip inaccessible directories
            }
        };

        await scan(rootDir);
        entries.sort();
        return entries;
    }

    private globToRegex(pattern: string): RegExp {
        let regexStr = pattern
            .replace(/\./g, "\\.")
            .replace(/\*\*/g, "\0GLOBSTAR\0")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]");

        // **/foo should match both "foo" (root) and "sub/foo" (nested)
        // Make the directory prefix optional when ** is followed by /
        regexStr = regexStr.replace(/\0GLOBSTAR\0\//g, "(.+/)?");
        // Standalone ** matches everything
        regexStr = regexStr.replace(/\0GLOBSTAR\0/g, ".*");

        return new RegExp(`^${regexStr}$`);
    }

    invalidate(pattern?: string): void {
        if (pattern) {
            for (const key of this.cache.keys()) {
                const idx = key.indexOf(":");
                if (idx !== -1) {
                    const keyPattern = key.substring(idx + 1);
                    if (keyPattern === pattern) {
                        this.cache.delete(key);
                    }
                } else {
                    if (key.includes(pattern)) {
                        this.cache.delete(key);
                    }
                }
            }
        } else {
            this.cache.clear();
        }
    }

    invalidateFile(filePath: string): void {
        this.cache.clear();
    }

    getStats() {
        return {
            hits: this.hits,
            misses: this.misses,
            size: this.cache.size,
        };
    }
}

export const globCache = new GlobCache();
