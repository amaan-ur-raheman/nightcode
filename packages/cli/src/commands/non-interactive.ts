import { createInterface } from 'readline';
import { readFile } from 'fs/promises';
import { getValidAuth } from '@/lib/auth';
import { apiClient } from '@/lib/api-client';
import {
    Mode,
    DEFAULT_CHAT_MODEL_ID,
    resolveProviderForModel,
} from '@nightcode/shared';
import { getApiKeyForProvider } from '@/lib/api-keys';

interface NonInteractiveOptions {
    prompt?: string;
    file?: string;
    timeout?: number;
}

export async function runNonInteractive(args: string[]): Promise<void> {
    const options = parseArgs(args);

    // Get input from file, argument, or stdin
    let input = '';

    if (options.file) {
        input = await readFile(options.file, 'utf-8');
    } else if (options.prompt) {
        input = options.prompt;
    } else {
        input = await readStdin();
    }

    if (!input.trim()) {
        console.error('No input provided.');
        process.exit(1);
    }

    // Verify auth
    const auth = await getValidAuth();
    if (!auth) {
        console.error(
            'Not authenticated. Run `nightcode` interactively first to sign in.',
        );
        process.exit(1);
    }

    try {
        // Create session
        const sessionRes = await apiClient.sessions.$post({
            json: { title: input.slice(0, 100) },
        });

        if (!sessionRes.ok) {
            let errorMsg = '';
            try {
                const parsed: unknown = await sessionRes.json();
                if (
                    typeof parsed === 'object' &&
                    parsed !== null &&
                    'error' in parsed &&
                    typeof (parsed as any).error === 'string'
                ) {
                    errorMsg = (parsed as any).error;
                }
            } catch {
                try {
                    errorMsg = await sessionRes.text();
                } catch {
                    // Ignore text read failures
                }
            }
            console.error(
                `Failed to create session: ${errorMsg || sessionRes.status}`,
            );
            process.exit(1);
        }

        const session = await sessionRes.json();

        // Send message via chat endpoint using raw fetch to handle streaming
        const chatUrl = `${process.env.API_URL ?? 'http://localhost:5959'}/chat`;
        const userMessage = {
            id: crypto.randomUUID(),
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: input }],
        };

        // Resolve provider API key to send with the request
        const providerKey = await (async () => {
            try {
                const provider = resolveProviderForModel(DEFAULT_CHAT_MODEL_ID);
                return await getApiKeyForProvider(provider);
            } catch {
                return null;
            }
        })();

        const chatHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
        };
        if (providerKey) {
            chatHeaders['x-provider-key'] = providerKey;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            options.timeout ?? 30_000,
        );

        const res = await fetch(chatUrl, {
            method: 'POST',
            headers: chatHeaders,
            body: JSON.stringify({
                id: session.id,
                messages: [userMessage],
                mode: Mode.BUILD,
                model: DEFAULT_CHAT_MODEL_ID,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            const body = await res.text();
            console.error(`Chat request failed (${res.status}): ${body}`);
            process.exit(1);
        }

        if (!res.body) {
            console.error('No response body');
            process.exit(1);
        }

        // Parse the AI SDK streaming response
        const text = await parseStreamResponse(res.body);
        process.stdout.write(text + '\n');
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            console.error('Request timed out.');
            process.exit(1);
        }
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}

/**
 * Parse the AI SDK UI message stream format.
 * Lines are prefixed with a type indicator:
 *   0:"text"  - text delta
 *   e:{...}   - finish metadata
 *   d:{...}   - done
 */
async function parseStreamResponse(
    body: ReadableStream<Uint8Array>,
): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (line.startsWith('0:')) {
                // Text delta - JSON-encoded string
                try {
                    const text = JSON.parse(line.slice(2));
                    if (typeof text === 'string') {
                        chunks.push(text);
                    }
                } catch {
                    // Skip malformed lines
                }
            }
        }
    }

    // Process remaining buffer
    if (buffer.startsWith('0:')) {
        try {
            const text = JSON.parse(buffer.slice(2));
            if (typeof text === 'string') {
                chunks.push(text);
            }
        } catch {
            // Skip
        }
    }

    return chunks.join('');
}

function parseArgs(args: string[]): NonInteractiveOptions {
    const options: NonInteractiveOptions = {};

    const promptIdx = args.indexOf('--prompt');
    if (promptIdx !== -1) {
        const val = args[promptIdx + 1];
        if (val) options.prompt = val;
    }

    const fileIdx = args.indexOf('--file');
    if (fileIdx !== -1) {
        const val = args[fileIdx + 1];
        if (val) options.file = val;
    }

    const timeoutIdx = args.indexOf('--timeout');
    if (timeoutIdx !== -1) {
        const val = args[timeoutIdx + 1];
        if (val) {
            options.timeout = parseInt(val, 10) || 30_000;
        }
    }

    return options;
}

function readStdin(): Promise<string> {
    // If stdin is not a TTY, read from it (piped input)
    if (!process.stdin.isTTY) {
        return new Promise((resolve, reject) => {
            const rl = createInterface({
                input: process.stdin,
                terminal: false,
            });

            const lines: string[] = [];

            rl.on('line', (line) => {
                lines.push(line);
            });

            rl.on('close', () => {
                resolve(lines.join('\n'));
            });

            rl.on('error', reject);
        });
    }

    // Stdin is a TTY - no piped input and no --prompt/--file
    return Promise.resolve('');
}
