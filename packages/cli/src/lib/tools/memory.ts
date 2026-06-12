import { toolInputSchemas } from '@nightcode/shared';
import { memory } from '../memory';

export async function memorySetTool(input: unknown) {
    const { key, value, tags } = toolInputSchemas.memorySet.parse(input);
    await memory.set(key, value, tags);
    return { output: `Stored "${key}" in memory` };
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
        output: entries
            .map(
                (e) =>
                    `${e.key}: ${e.value.substring(0, 80)}${e.value.length > 80 ? '...' : ''}`,
            )
            .join('\n'),
    };
}

export async function memorySearchTool(input: unknown) {
    const { query } = toolInputSchemas.memorySearch.parse(input);
    const entries = await memory.search(query);
    if (entries.length === 0)
        return { output: `No memories matching "${query}"` };
    return {
        output: entries
            .map(
                (e) =>
                    `${e.key}: ${e.value.substring(0, 80)}${e.value.length > 80 ? '...' : ''}`,
            )
            .join('\n'),
    };
}
