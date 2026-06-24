import type { Message } from './types';

const MAX_SUBAGENT_OUTPUT_CHARS = 8000;

/**
 * Prune subagent tool outputs that exceed the size limit.
 * Keeps the first and last portion, replacing the middle with a truncation notice.
 */
export function pruneToolOutput(output: unknown): unknown {
    if (output == null) return output;
    if (typeof output === 'object' && 'result' in output) {
        const result = (output as { result: string }).result;
        if (
            typeof result === 'string' &&
            result.length > MAX_SUBAGENT_OUTPUT_CHARS
        ) {
            const head = result.slice(0, MAX_SUBAGENT_OUTPUT_CHARS / 2);
            const tail = result.slice(-MAX_SUBAGENT_OUTPUT_CHARS / 2);
            return {
                ...output,
                result: `${head}\n\n... [truncated ${result.length - MAX_SUBAGENT_OUTPUT_CHARS} chars] ...\n\n${tail}`,
            };
        }
    }
    return output;
}

/**
 * Prune old messages to keep context size manageable.
 * For messages older than the last 10, truncate large tool outputs.
 */
export function pruneOldMessages(messages: Message[]): Message[] {
    if (messages.length <= 10) return messages;
    const recentCount = 10;
    const oldMessages = messages.slice(0, messages.length - recentCount);
    const recentMessages = messages.slice(messages.length - recentCount);

    return [
        ...oldMessages.map((msg) => {
            if (msg.role !== 'assistant' || !Array.isArray(msg.parts))
                return msg;
            return {
                ...msg,
                parts: msg.parts.map((part) => {
                    if (
                        part.type === 'dynamic-tool' ||
                        (typeof part.type === 'string' &&
                            part.type.startsWith('tool-'))
                    ) {
                        const toolPart = part as any;
                        if (
                            toolPart.state === 'output-available' &&
                            toolPart.output != null
                        ) {
                            return {
                                ...toolPart,
                                output: pruneToolOutput(toolPart.output),
                            };
                        }
                    }
                    return part;
                }),
            };
        }),
        ...recentMessages,
    ];
}
