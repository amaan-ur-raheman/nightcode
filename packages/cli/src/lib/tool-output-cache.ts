import { createHash } from 'crypto';

/**
 * LRU cache for tool outputs.
 * Avoids re-executing identical tool calls within a short time window.
 * Key: toolName + input hash. Value: result + timestamp.
 *
 * Design:
 * - Max 256 entries (LRU eviction when full)
 * - 30s TTL per entry (stale entries are evicted on access)
 * - Only caches deterministic, read-only tools (no mutations, no side effects)
 */

const CACHE_MAX_ENTRIES = 256;
const CACHE_TTL_MS = 30_000;

/** Tools safe to cache (read-only, deterministic given same input). */
const CACHEABLE_TOOLS = new Set([
    'readFile',
    'listDirectory',
    'glob',
    'grep',
    'tree',
    'fileInfo',
    'gitStatus',
    'gitDiff',
    'gitLog',
    'gitBlame',
    'gitStatusExtended',
    'codeSearch',
    'getOutline',
    'diffFiles',
    'tokenCount',
    'memoryGet',
    'memoryList',
    'memorySearch',
    'memoryFuzzySearch',
    'memoryStats',
    'keychainGet',
    'getTaskStatus',
    'getKnowledgeNeighbors',
    'queryKnowledgeGraph',
    'detectKnowledgeCycles',
    'getKnowledgeStats',
    'impactAnalysis',
    'breakingChangeCheck',
    'suggestMigration',
    'checkExternalChanges',
    'reviewPr',
    'semanticSearch',
    'profileCode',
]);

interface CacheEntry {
    result: unknown;
    expiresAt: number;
}

class ToolOutputCache {
    private cache = new Map<string, CacheEntry>();
    private hits = 0;
    private misses = 0;

    /** Check if a tool is cacheable. */
    isCacheable(toolName: string): boolean {
        return CACHEABLE_TOOLS.has(toolName);
    }

    /** Generate a cache key from tool name and input. */
    private makeKey(toolName: string, input: unknown): string {
        let inputStr: string;
        try {
            inputStr = JSON.stringify(input ?? {});
        } catch {
            // Handle circular references gracefully
            inputStr = String(input);
        }
        const hash = createHash('sha256')
            .update(inputStr)
            .digest('hex')
            .slice(0, 16);
        return `${toolName}:${hash}`;
    }

    /** Get a cached result if available and not expired. */
    get(toolName: string, input: unknown): unknown | undefined {
        if (!this.isCacheable(toolName)) return undefined;

        const key = this.makeKey(toolName, input);
        const entry = this.cache.get(key);

        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        this.hits++;
        // Move to end (most recently used) by re-inserting
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.result;
    }

    /** Store a result in the cache. */
    set(toolName: string, input: unknown, result: unknown): void {
        if (!this.isCacheable(toolName)) return;

        const key = this.makeKey(toolName, input);

        // Evict LRU if at capacity
        if (this.cache.size >= CACHE_MAX_ENTRIES && !this.cache.has(key)) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }

        // Delete and re-insert to update LRU order
        this.cache.delete(key);
        this.cache.set(key, {
            result,
            expiresAt: Date.now() + CACHE_TTL_MS,
        });
    }

    /** Get cache statistics. */
    stats(): { size: number; hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }

    /** Clear all cached entries. */
    clear(): void {
        this.cache.clear();
    }
}

export const toolOutputCache = new ToolOutputCache();
