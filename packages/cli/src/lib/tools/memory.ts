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

export async function memorySetTool(input: unknown) {
    const { key, value, tags, ttlMs } = toolInputSchemas.memorySet.parse(input);
    await memory.set(key, value, tags, ttlMs);
    const ttlHint = ttlMs
        ? ` (expires in ${Math.round(ttlMs / 60_000)}min)`
        : '';
    return { output: `Stored "${key}" in memory${ttlHint}` };
}

export async function memoryGetTool(input: unknown) {
    const { key } = toolInputSchemas.memoryGet.parse(input);
    const value = await memory.get(key);
    if (!value) return { output: `No memory found for "${key}"` };
    return { output: `${key}: ${value}` };
}

export async function memoryDeleteTool(input: unknown) {
    const { key } = toolInputSchemas.memoryDelete.parse(input);
    const deleted = await memory.delete(key);
    if (!deleted) return { output: `No memory found for "${key}"` };
    return { output: `Deleted memory "${key}"` };
}

export async function memoryListTool(input: unknown) {
    const { tag } = toolInputSchemas.memoryList.parse(input);
    const entries = await memory.list(tag ? { tag } : undefined);
    if (entries.length === 0) return { output: 'No memories stored' };
    return {
        output: entries.map(formatEntry).join('\n'),
    };
}

export async function memorySearchTool(input: unknown) {
    const { query } = toolInputSchemas.memorySearch.parse(input);
    const entries = await memory.search(query);
    if (entries.length === 0)
        return { output: `No memories matching "${query}"` };
    return {
        output: entries.map(formatEntry).join('\n'),
    };
}

export async function memoryFuzzySearchTool(input: unknown) {
    const { query, maxDist } = toolInputSchemas.memoryFuzzySearch.parse(input);
    const entries = await memory.fuzzySearch(query, maxDist);
    if (entries.length === 0)
        return {
            output: `No memories fuzzy-matching "${query}" (max distance: ${maxDist})`,
        };
    return {
        output: entries.map(formatEntry).join('\n'),
    };
}

export async function memoryStatsTool() {
    const stats = await memory.stats();
    const lines = [
        `Total entries: ${stats.totalEntries}`,
        `Tags: ${stats.totalTags.length > 0 ? stats.totalTags.join(', ') : 'none'}`,
        `Expired: ${stats.expiredEntries}`,
    ];
    if (stats.oldestEntry) lines.push(`Oldest: ${stats.oldestEntry}`);
    if (stats.newestEntry) lines.push(`Newest: ${stats.newestEntry}`);
    if (stats.mostAccessed)
        lines.push(
            `Most accessed: ${stats.mostAccessed.key} (${stats.mostAccessed.accessCount}x)`,
        );
    return { output: lines.join('\n') };
}
