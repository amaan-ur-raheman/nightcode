export function safeStringify(value: unknown, space?: number): string {
    if (typeof value === "string") return value;

    const seen = new WeakSet<object>();
    try {
        return JSON.stringify(value, (_key, nested) => {
            if (typeof nested === "bigint") return nested.toString();
            if (typeof nested === "object" && nested !== null) {
                if (seen.has(nested)) return "[Circular]";
                seen.add(nested);
            }
            return nested;
        }, space) ?? String(value);
    } catch (error) {
        return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`;
    }
}

export function safeTruncatedString(value: unknown, limit: number): string {
    const serialized = safeStringify(value);
    return serialized.length > limit
        ? `${serialized.slice(0, limit)}\n... (truncated, ${serialized.length} total chars)`
        : serialized;
}
