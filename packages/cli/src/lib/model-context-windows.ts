// Approximate context window sizes for common models (in tokens)
// These are approximate and may vary by provider

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // Claude models
    'claude-sonnet-4-20250514': 200_000,
    'claude-3-5-haiku-20241022': 200_000,
    'claude-3-5-sonnet-20241022': 200_000,
    'claude-3-opus-20240229': 200_000,
    'claude-3-haiku-20240307': 200_000,

    // GPT models
    'gpt-4o': 128_000,
    'gpt-4o-mini': 128_000,
    'gpt-4-turbo': 128_000,
    'o3-mini': 128_000,

    // Groq models
    'llama-3.3-70b-versatile': 32_000,
    'mixtral-8x7b-32768': 32_000,
    'llama-3.1-8b-instant': 131_072,

    // NVIDIA NIM models
    'nvidia/nemotron-3-ultra-550b-a55b': 131_072,
    'nvidia/mistralai/mistral-medium-3.5-128b': 32_000,
    'nvidia/deepseek-ai/deepseek-v4-flash': 131_072,
    'nvidia/deepseek-ai/deepseek-v4-pro': 131_072,
    'nvidia/meta/llama-3.3-70b-instruct': 131_072,

    // OpenCode Zen models (conservative estimates)
    'opencode/deepseek-v4-flash-free': 131_072,
    'opencode/nemotron-3-ultra-free': 131_072,
    'opencode/minimax-m3-free': 131_072,
    'opencode/mimo-v2.5-free': 131_072,
    'opencode/north-mini-code-free': 32_000,
    'opencode/big-pickle': 131_072,
    'opencode/qwen3.6-plus-free': 131_072,
    'opencode/gpt-5.5': 200_000,
    'opencode/gpt-5.4': 200_000,
    'opencode/gpt-5.4-mini': 200_000,
    'opencode/gpt-5.4-nano': 200_000,
    'opencode/gpt-5.3-codex': 200_000,
    'opencode/gpt-5.2': 200_000,
    'opencode/gpt-5.1-codex': 200_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export function getContextWindow(model: string): number {
    // Try exact match first
    if (model in MODEL_CONTEXT_WINDOWS) {
        return MODEL_CONTEXT_WINDOWS[model]!;
    }

    // Try partial match — prefer longest key (most specific model name)
    let bestKey: string | null = null;
    for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
        if (model.includes(key)) {
            if (!bestKey || key.length > bestKey.length) {
                bestKey = key;
            }
        }
    }
    if (bestKey) {
        return MODEL_CONTEXT_WINDOWS[bestKey]!;
    }

    return DEFAULT_CONTEXT_WINDOW;
}

export function estimateMessageTokens(messages: any[]): number {
    let totalTokens = 0;
    for (const msg of messages) {
        // Estimate 4 chars per token
        if (msg.content) {
            totalTokens += Math.ceil(String(msg.content).length / 4);
        }
        if (msg.parts) {
            for (const part of msg.parts) {
                if (part.type === 'text' && part.text) {
                    totalTokens += Math.ceil(part.text.length / 4);
                }
            }
        }
    }
    return totalTokens;
}
