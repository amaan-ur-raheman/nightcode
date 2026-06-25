import { toolInputSchemas } from '@nightcode/shared';
import { memory } from '../memory';

function formatEntry(e: {
    key: string;
    value: string;
    tags?: string[];
    accessCount?: number;
}): string {
    const val =
        e.value.length > 80 ? e.value.substring(0, 80) + '...' : e.value;
    const tags = e.tags?.length ? ` [${e.tags.join(', ')}]` : '';
    const hits = (e.accessCount ?? 0) > 0 ? ` (${e.accessCount}x)` : '';
    return `${e.key}${tags}${hits}: ${val}`;
}

export async function workspaceMemoryTool(input: unknown) {
    const parsed = toolInputSchemas.workspace_memory.parse(input);
    const { action } = parsed;

    if (action === 'set') {
        const { key, value, tags, ttlMs } = parsed;
        if (!key || value === undefined) {
            throw new Error('key and value are required for set action');
        }
        await memory.set(key, value, tags, ttlMs);
        const ttlHint = ttlMs
            ? ` (expires in ${Math.round(ttlMs / 60_000)}min)`
            : '';
        return { output: `Stored "${key}" in memory${ttlHint}` };
    }

    if (action === 'get') {
        const { key } = parsed;
        if (!key) throw new Error('key is required for get action');
        const value = await memory.get(key);
        if (!value) return { output: `No memory found for "${key}"` };
        return { output: `${key}: ${value}` };
    }

    if (action === 'delete') {
        const { key } = parsed;
        if (!key) throw new Error('key is required for delete action');
        const deleted = await memory.delete(key);
        if (!deleted) return { output: `No memory found for "${key}"` };
        return { output: `Deleted memory "${key}"` };
    }

    if (action === 'list') {
        const { tag } = parsed;
        const entries = await memory.list(tag ? { tag } : undefined);
        if (entries.length === 0) return { output: 'No memories stored' };
        return { output: entries.map(formatEntry).join('\n') };
    }

    if (action === 'search') {
        const { query } = parsed;
        if (!query) throw new Error('query is required for search action');
        const entries = await memory.search(query);
        if (entries.length === 0)
            return { output: `No memories matching "${query}"` };
        return { output: entries.map(formatEntry).join('\n') };
    }

    if (action === 'fuzzy_search') {
        const { query, maxDist } = parsed;
        if (!query)
            throw new Error('query is required for fuzzy_search action');
        const entries = await memory.fuzzySearch(query, maxDist);
        if (entries.length === 0) {
            return {
                output: `No memories fuzzy-matching "${query}" (max distance: ${maxDist})`,
            };
        }
        return { output: entries.map(formatEntry).join('\n') };
    }

    if (action === 'stats') {
        const stats = await memory.stats();
        const lines = [
            `Total entries: ${stats.totalEntries}`,
            `Tags: ${stats.totalTags.length > 0 ? stats.totalTags.join(', ') : 'none'}`,
            `Expired: ${stats.expiredEntries}`,
        ];
        if (stats.oldestEntry) lines.push(`Oldest: ${stats.oldestEntry}`);
        if (stats.newestEntry) lines.push(`Newest: ${stats.newestEntry}`);
        if (stats.mostAccessed) {
            lines.push(
                `Most accessed: ${stats.mostAccessed.key} (${stats.mostAccessed.accessCount}x)`,
            );
        }
        return { output: lines.join('\n') };
    }

    throw new Error(`Unknown action: ${action}`);
}
