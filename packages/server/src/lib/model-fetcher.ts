import type { DynamicModel, SupportedProvider } from '@nightcode/shared';

type ProviderFetcher = (apiKey?: string) => Promise<DynamicModel[]>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cache: {
    models: DynamicModel[];
    providers: string[];
    fetchedAt: number;
} | null = null;

// ── Helpers ──

function deriveDisplayName(modelId: string): string {
    // "nvidia/nemotron-3-ultra-550b-a55b" → "Nemotron 3 Ultra 550B"
    const id = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    return id
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\s+/g, ' ')
        .trim();
}

function parsePrice(priceStr: string | undefined): number {
    if (!priceStr) return 0;
    const price = parseFloat(priceStr);
    return isNaN(price) ? 0 : price * 1_000_000; // Convert per-token to per-million-tokens
}

// ── OpenRouter (richest source, no auth) ──

async function fetchOpenRouter(): Promise<DynamicModel[]> {
    try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as any;
        const models: any[] = data?.data ?? [];
        return models
            .filter((m) => {
                const modalities = m?.architecture?.output_modalities ?? [];
                if (!modalities.includes('text')) return false;
                const id = m.id ?? '';
                return (
                    !id.includes('embedding') &&
                    !id.includes('rerank') &&
                    !id.includes('moderation') &&
                    !id.includes('guard') &&
                    !id.includes('embed') &&
                    !id.includes('image') &&
                    !id.includes('video') &&
                    !id.includes('audio') &&
                    !id.includes('tts') &&
                    !id.includes('stt')
                );
            })
            .map((m) => ({
                id: `openrouter/${m.id}` as string,
                displayName: (m.name as string) ?? deriveDisplayName(m.id),
                provider: 'openrouter' as SupportedProvider,
                contextLength: m.context_length as number | undefined,
                pricing: {
                    inputUsdPerMillionTokens: parsePrice(m.pricing?.prompt),
                    outputUsdPerMillionTokens: parsePrice(
                        m.pricing?.completion,
                    ),
                },
                capabilities: {
                    vision: (m.architecture?.input_modalities ?? []).includes(
                        'image',
                    ),
                    tools: (m.supported_parameters ?? []).includes('tools'),
                    reasoning: (m.supported_parameters ?? []).includes(
                        'reasoning',
                    ),
                },
            }));
    } catch {
        return [];
    }
}

// ── NIM (no auth required) ──

async function fetchNim(): Promise<DynamicModel[]> {
    try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as any;
        const models: any[] = data?.data ?? [];
        return models
            .filter((m) => {
                const id = m.id ?? '';
                // Filter out non-chat models
                return (
                    !id.includes('embedding') &&
                    !id.includes('rerank') &&
                    !id.includes('moderation') &&
                    !id.includes('guard') &&
                    !id.includes('embed') &&
                    !id.includes('image') &&
                    !id.includes('video') &&
                    !id.includes('audio') &&
                    !id.includes('tts') &&
                    !id.includes('stt')
                );
            })
            .map((m) => ({
                id: `nvidia/${m.id}` as string,
                displayName: deriveDisplayName(m.id),
                provider: 'nvidia' as SupportedProvider,
                pricing: {
                    inputUsdPerMillionTokens: 0,
                    outputUsdPerMillionTokens: 0,
                },
            }));
    } catch {
        return [];
    }
}

// ── OpenCode Zen (no auth required) ──

async function fetchZen(): Promise<DynamicModel[]> {
    try {
        const res = await fetch('https://opencode.ai/zen/v1/models', {
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as any;
        const models: any[] = data?.data ?? [];
        return models
            .filter((m) => {
                const id = m.id ?? '';
                return (
                    !id.includes('embedding') &&
                    !id.includes('rerank') &&
                    !id.includes('image') &&
                    !id.includes('audio') &&
                    !id.includes('tts')
                );
            })
            .map((m) => ({
                id: `opencode/${m.id}` as string,
                displayName: deriveDisplayName(m.id),
                provider: 'opencode' as SupportedProvider,
                pricing: {
                    inputUsdPerMillionTokens: 0,
                    outputUsdPerMillionTokens: 0,
                },
            }));
    } catch {
        return [];
    }
}

// ── Generic OpenAI-compatible /v1/models fetcher ──

async function fetchOpenAICompatible(
    name: string,
    baseUrl: string,
    apiKey: string,
    provider: SupportedProvider,
): Promise<DynamicModel[]> {
    if (!apiKey) return [];
    try {
        const res = await fetch(`${baseUrl}/v1/models`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as any;
        const models: any[] = data?.data ?? [];
        return models
            .filter((m) => {
                const id = m.id ?? '';
                return (
                    !id.includes('embedding') &&
                    !id.includes('rerank') &&
                    !id.includes('moderation') &&
                    !id.includes('image') &&
                    !id.includes('tts') &&
                    !id.includes('stt')
                );
            })
            .map((m) => ({
                id: `${provider}/${m.id}` as string,
                displayName: deriveDisplayName(m.id),
                provider,
                pricing: {
                    inputUsdPerMillionTokens: 0,
                    outputUsdPerMillionTokens: 0,
                },
            }));
    } catch {
        return [];
    }
}

// ── Kilo Gateway (OpenAI-compatible, no auth for listing) ──

async function fetchKilo(): Promise<DynamicModel[]> {
    try {
        const res = await fetch('https://api.kilo.ai/api/gateway/models', {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as any;
        const models: any[] = data?.data ?? [];
        return models
            .filter((m) => {
                const modalities = m?.architecture?.output_modalities ?? [];
                if (!modalities.includes('text')) return false;
                const id = m.id ?? '';
                return (
                    !id.includes('embedding') &&
                    !id.includes('rerank') &&
                    !id.includes('moderation') &&
                    !id.includes('guard') &&
                    !id.includes('tts') &&
                    !id.includes('stt')
                );
            })
            .map((m) => ({
                id: `kilo/${m.id}` as string,
                displayName: (m.name as string) ?? deriveDisplayName(m.id),
                provider: 'kilo' as SupportedProvider,
                contextLength: m.context_length as number | undefined,
                pricing: {
                    inputUsdPerMillionTokens: parsePrice(m.pricing?.prompt),
                    outputUsdPerMillionTokens: parsePrice(
                        m.pricing?.completion,
                    ),
                },
                capabilities: {
                    vision: (m.architecture?.input_modalities ?? []).includes(
                        'image',
                    ),
                    tools: (m.supported_parameters ?? []).includes('tools'),
                    reasoning: (m.supported_parameters ?? []).includes(
                        'reasoning',
                    ),
                },
            }));
    } catch {
        return [];
    }
}

// ── Gemini (different API shape) ──

async function fetchGemini(clientKey?: string): Promise<DynamicModel[]> {
    const apiKey = clientKey ?? process.env.GOOGLE_API_KEY ?? '';
    if (!apiKey) return [];
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
            { signal: AbortSignal.timeout(10000) },
        );
        if (!res.ok) return [];
        const data = (await res.json()) as any;
        const models: any[] = data?.models ?? [];
        return models
            .filter((m) => {
                const methods = m.supportedGenerationMethods ?? [];
                return methods.includes('generateContent');
            })
            .map((m) => ({
                id: `gemini/${m.name?.replace('models/', '') ?? ''}` as string,
                displayName:
                    (m.displayName as string) ??
                    deriveDisplayName(m.name ?? ''),
                provider: 'gemini' as SupportedProvider,
                contextLength: m.inputTokenLimit as number | undefined,
            }));
    } catch {
        return [];
    }
}

// ── Main fetcher ──

const FETCHERS: Array<{ provider: SupportedProvider; fetch: ProviderFetcher }> =
    [
        { provider: 'openrouter', fetch: fetchOpenRouter },
        { provider: 'nvidia', fetch: fetchNim },
        { provider: 'opencode', fetch: fetchZen },
        {
            provider: 'together',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Together AI',
                    'https://api.together.xyz',
                    key ?? process.env.TOGETHER_API_KEY ?? '',
                    'together',
                ),
        },
        {
            provider: 'fireworks',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Fireworks AI',
                    'https://api.fireworks.ai',
                    key ?? process.env.FIREWORKS_API_KEY ?? '',
                    'fireworks',
                ),
        },
        {
            provider: 'cerebras',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Cerebras',
                    'https://api.cerebras.ai',
                    key ?? process.env.CEREBRAS_API_KEY ?? '',
                    'cerebras',
                ),
        },
        {
            provider: 'deepseek',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'DeepSeek',
                    'https://api.deepseek.com',
                    key ?? process.env.DEEPSEEK_API_KEY ?? '',
                    'deepseek',
                ),
        },
        { provider: 'gemini', fetch: (key) => fetchGemini(key) },
        { provider: 'kilo', fetch: fetchKilo },
    ];

export async function fetchAllModels(
    apiKeys?: Record<string, string>,
): Promise<{
    models: DynamicModel[];
    providers: string[];
    cached: boolean;
    fetchedAt: number;
}> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return { ...cache, cached: true };
    }

    const results = await Promise.allSettled(
        FETCHERS.map((f) => f.fetch(apiKeys?.[f.provider])),
    );
    const models: DynamicModel[] = [];
    const providerSet = new Set<string>();

    for (const result of results) {
        if (result.status === 'fulfilled') {
            for (const model of result.value) {
                models.push(model);
                providerSet.add(model.provider);
            }
        }
    }

    const fetchedAt = Date.now();
    cache = {
        models,
        providers: Array.from(providerSet).sort(),
        fetchedAt,
    };

    return { ...cache, cached: false };
}

export function clearModelCache(): void {
    cache = null;
}
