import { isAbsolute, relative, resolve } from "path";
import { stat, readFile, writeFile } from "fs/promises";

export const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage"]);

export const PRIVATE_IPS = [
    "localhost", "127.", "0.0.0.0", "10.", "192.168.", "169.254.", "::1", ".local",
    "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
];

export function isPrivateHost(hostname: string): boolean {
    return PRIVATE_IPS.some((p) => hostname === p || hostname.startsWith(p) || hostname.endsWith(p));
}

export const MAX_FILE_SIZE = 100_000;
export const MAX_RESULTS = 200;
export const MAX_MATCHES = 50;
export const MAX_OUTPUT = 50_000;
export const MAX_TREE_LINES = 500;
export const MAX_DIFF = 50_000;
export const MAX_PATCH_SIZE = 200_000;
export const MAX_TEST_OUTPUT = 50_000;

export function resolveInsideCwd(path: string) {
    const cwd = process.cwd();
    const resolved = resolve(cwd, path);
    const rel = relative(cwd, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("Path is outside the project directory");
    }
    return { cwd, resolved };
}

export function truncate(value: string, limit: number) {
    return value.length > limit
        ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
        : value;
}

export async function runGit(cwd: string, args: string[]) {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: await proc.exited };
}

interface CacheEntry {
    content: string;
    mtime: number;
}

const MAX_CACHE_ENTRIES = 512;

/**
 * Simple LRU cache backed by a Map (which preserves insertion order).
 * On eviction, the oldest entry is removed.
 */
class LruCache<K, V> {
    private map = new Map<K, V>();
    private max: number;

    constructor(max: number) {
        this.max = max;
    }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            // Move to end (most-recently used)
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.max) {
            // Evict the oldest (first) entry
            const firstKey = this.map.keys().next().value;
            if (firstKey !== undefined) this.map.delete(firstKey);
        }
        this.map.set(key, value);
    }
}

const fileContentCache = new LruCache<string, CacheEntry>(MAX_CACHE_ENTRIES);

export async function readCachedFile(resolvedPath: string): Promise<string> {
    const info = await stat(resolvedPath);
    const mtime = info.mtimeMs;
    const cached = fileContentCache.get(resolvedPath);
    if (cached && cached.mtime === mtime) {
        return cached.content;
    }
    const content = await readFile(resolvedPath, "utf-8");
    fileContentCache.set(resolvedPath, { content, mtime });
    return content;
}

export interface ReplaceResult {
    path: string;
    replacements: number;
}

export async function globReplace(
    globPattern: string,
    replaceFn: (content: string) => { updated: string; count: number },
): Promise<{ filesChanged: number; changes: ReplaceResult[] }> {
    const cwd = process.cwd();
    const g = new Bun.Glob(globPattern);

    const files: string[] = [];
    for await (const file of g.scan({ cwd, absolute: false, onlyFiles: true })) {
        const resolved = resolve(cwd, file);
        const rel = relative(cwd, resolved);
        if (rel.startsWith("..") || isAbsolute(rel)) continue;
        files.push(resolved);
    }

    const results = await Promise.all(
        files.map(async (resolved) => {
            const content = await readFile(resolved, "utf-8");
            const { updated, count } = replaceFn(content);
            if (count > 0) {
                await writeFile(resolved, updated, "utf-8");
                return { path: relative(cwd, resolved), replacements: count };
            }
            return null;
        })
    );

    const changes = results.filter((r): r is ReplaceResult => r !== null);
    return { filesChanged: changes.length, changes };
}
