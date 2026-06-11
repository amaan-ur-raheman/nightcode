import { getProviderName, isModelAvailable } from "./providers";

type FallbackConfig = {
    primary: string;
    fallbacks: string[];
    maxRetries: number;
    retryDelayMs: number;
};

// Default fallback chains per provider
const FALLBACK_CHAINS: Record<string, string[]> = {
    "nim": [
        "deepseek-ai/deepseek-v4-pro",
        "qwen/qwen3.5-397b-a17b",
        "meta/llama-3.3-70b-instruct",
    ],
    "anthropic": [
        "gpt-4o",
        "nvidia/nemotron-3-ultra-550b-a55b",
    ],
    "openai": [
        "claude-sonnet-4-20250514",
        "nvidia/nemotron-3-ultra-550b-a55b",
    ],
    "groq": [
        "nvidia/nemotron-3-ultra-550b-a55b",
        "deepseek-ai/deepseek-v4-pro",
    ],
    "opencode": [
        "opencode/gpt-5.4",
        "opencode/claude-sonnet-4-6",
        "opencode/deepseek-v4-flash-free",
    ],
};

export function getFallbackChain(modelId: string): string[] {
    const provider = getProviderName(modelId);
    return (FALLBACK_CHAINS[provider] ?? FALLBACK_CHAINS["nim"]) as string[];
}

function isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) return true;
        if (msg.includes("invalid api key") || msg.includes("authentication")) return true;
    }
    if (typeof error === "object" && error !== null && "statusCode" in error) {
        const status = (error as { statusCode: number }).statusCode;
        if (status === 401 || status === 403) return true;
    }
    return false;
}

function getFriendlyModelName(modelId: string): string {
    // Extract human-readable name from model IDs like "deepseek-ai/deepseek-v4-pro"
    const parts = modelId.split("/");
    const name = parts[parts.length - 1] ?? modelId;
    return name
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/ v4 pro/i, " V4 Pro")
        .replace(/ v4 flash/i, " V4 Flash");
}

export type FallbackResult<T> = {
    result: T;
    modelUsed: string;
    fallbackTriggered: boolean;
    note?: string;
};

/**
 * Execute an async function with automatic model fallback.
 *
 * The callback receives the current modelId to try. If it fails with a
 * retryable error, the next model in the fallback chain is attempted.
 *
 * Auth errors (401/403) are never retried — they won't fix themselves.
 * Rate limits (429) trigger immediate fallback to the next model.
 */
export async function withFallback<T>(
    fn: (modelId: string) => Promise<T>,
    primaryModelId: string,
    maxRetries: number = 2,
): Promise<FallbackResult<T>> {
    const rawChain = [primaryModelId, ...getFallbackChain(primaryModelId)];
    // Filter to only models with available API keys (primary is always included)
    const chain: string[] = [primaryModelId];
    for (const modelId of rawChain.slice(1)) {
        if (await isModelAvailable(modelId)) {
            chain.push(modelId);
        }
    }
    let lastError: Error | undefined;

    for (let i = 0; i <= maxRetries && i < chain.length; i++) {
        const currentModel = chain[i];
        if (!currentModel) continue;
        try {
            const result = await fn(currentModel);
            const fallbackTriggered = i > 0;
            const note = fallbackTriggered
                ? `(Note: Primary model unavailable, using fallback: ${getFriendlyModelName(currentModel)})`
                : undefined;

            if (fallbackTriggered) {
                console.warn(
                    `[fallback] Model ${primaryModelId} failed, fell back to ${currentModel} after ${i} attempt(s)`,
                );
            }

            return { result, modelUsed: currentModel, fallbackTriggered, note };
        } catch (err) {
            lastError = err as Error;

            if (isNonRetryableError(err)) {
                console.error(
                    `[fallback] Non-retryable error on ${currentModel}: ${lastError.message}`,
                );
                throw lastError;
            }

            console.error(
                `[fallback] Model ${currentModel} failed (attempt ${i + 1}/${Math.min(maxRetries + 1, chain.length)}): ${lastError.message}`,
            );
        }
    }

    throw lastError!;
}
