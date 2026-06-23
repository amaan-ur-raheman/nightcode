import {
    registerLocalModel,
    CLOUDFLARE_ACCOUNT_ID_KEYCHAIN,
    keychain,
    type DynamicModel,
    type SupportedProvider,
} from '@nightcode/shared';

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
        .replace(/[-_:]/g, ' ')
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
    } catch (err) {
        console.error(
            '[model-fetcher] Failed to fetch models from OpenRouter:',
            err instanceof Error ? err.message : err,
        );
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
    } catch (err) {
        console.error(
            '[model-fetcher] Failed to fetch models from NVIDIA NIM:',
            err instanceof Error ? err.message : err,
        );
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
    } catch (err) {
        console.error(
            '[model-fetcher] Failed to fetch models from OpenCode Zen:',
            err instanceof Error ? err.message : err,
        );
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
    } catch (err) {
        console.error(
            `[model-fetcher] Failed to fetch models from ${name}:`,
            err instanceof Error ? err.message : err,
        );
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
    } catch (err) {
        console.error(
            '[model-fetcher] Failed to fetch models from Kilo:',
            err instanceof Error ? err.message : err,
        );
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
    } catch (err) {
        console.error(
            '[model-fetcher] Failed to fetch models from Gemini:',
            err instanceof Error ? err.message : err,
        );
        return [];
    }
}

// ── Local Ollama (dynamic, local network check) ──

async function fetchLocalOllama(): Promise<DynamicModel[]> {
    try {
        const res = await fetch('http://localhost:11434/api/tags', {
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as any;
        const models: any[] = data?.models ?? [];
        return models.map((m) => {
            const modelId = `local/${m.name}`;
            registerLocalModel(modelId);
            return {
                id: modelId,
                displayName: deriveDisplayName(m.name),
                provider: 'local' as SupportedProvider,
                pricing: {
                    inputUsdPerMillionTokens: 0.1,
                    outputUsdPerMillionTokens: 0.1,
                },
            };
        });
    } catch (err) {
        console.error(
            '[model-fetcher] Failed to fetch models from Local Ollama:',
            err instanceof Error ? err.message : err,
        );
        return [];
    }
}

// ── LM Studio (local, no auth required) ──

async function fetchLMStudio(): Promise<DynamicModel[]> {
    try {
        const res = await fetch('http://localhost:1234/v1/models', {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(3000),
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
                id: `lmstudio/${m.id}` as string,
                displayName: deriveDisplayName(m.id),
                provider: 'lmstudio' as SupportedProvider,
                pricing: {
                    inputUsdPerMillionTokens: 0,
                    outputUsdPerMillionTokens: 0,
                },
            }));
    } catch (err) {
        // LM Studio is local — don't spam errors if it's not running
        return [];
    }
}

// ── Cloudflare Workers AI (requires Account ID + API key) ──

async function fetchCloudflare(clientKey?: string): Promise<DynamicModel[]> {
    const apiKey = clientKey ?? process.env.CLOUDFLARE_API_KEY ?? '';

    // Resolve Account ID from keychain or env var
    let accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
    if (!accountId && keychain.isAvailable()) {
        try {
            const keychainAccountId = await keychain.getKey(
                CLOUDFLARE_ACCOUNT_ID_KEYCHAIN,
            );
            if (keychainAccountId) accountId = keychainAccountId;
        } catch {
            // Ignore keychain errors
        }
    }

    if (!apiKey || !accountId) {
        console.warn(
            `[model-fetcher] Cloudflare: Missing credentials (apiKey=${apiKey ? 'set' : 'missing'}, accountId=${accountId ? 'set' : 'missing'})`,
        );
        return [];
    }
    try {
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=text-generation&hide_experimental=false&per_page=100`;
        console.log(`[model-fetcher] Fetching Cloudflare models from: ${url}`);
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            console.error(
                `[model-fetcher] Cloudflare API returned ${res.status}: ${await res.text()}`,
            );
            return [];
        }
        const data = (await res.json()) as any;
        const models: any[] = data?.result ?? [];
        console.log(
            `[model-fetcher] Cloudflare: Found ${models.length} text-generation models`,
        );
        return models.map((m) => ({
            id: `cloudflare/${m.id}` as string,
            displayName: (m.name as string) ?? deriveDisplayName(m.id),
            provider: 'cloudflare' as SupportedProvider,
            pricing: {
                inputUsdPerMillionTokens: 0,
                outputUsdPerMillionTokens: 0,
            },
        }));
    } catch (err) {
        console.error(
            '[model-fetcher] Failed to fetch models from Cloudflare Workers AI:',
            err instanceof Error ? err.message : err,
        );
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
        { provider: 'local', fetch: fetchLocalOllama },
        {
            provider: 'lightningai',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Lightning AI',
                    'https://lightning.ai/api',
                    key ?? process.env.LIGHTNINGAI_API_KEY ?? '',
                    'lightningai',
                ),
        },
        { provider: 'cloudflare', fetch: (key) => fetchCloudflare(key) },
        {
            provider: 'zenmux',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'ZenMux',
                    'https://zenmux.ai/api',
                    key ?? process.env.ZENMUX_API_KEY ?? '',
                    'zenmux',
                ),
        },
        {
            provider: 'mistral',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Mistral AI',
                    'https://api.mistral.ai',
                    key ?? process.env.MISTRAL_API_KEY ?? '',
                    'mistral',
                ),
        },
        {
            provider: 'qwen',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Qwen (DashScope)',
                    'https://dashscope.aliyuncs.com/compatible-mode',
                    key ?? process.env.DASHSCOPE_API_KEY ?? '',
                    'qwen',
                ),
        },
        {
            provider: 'perplexity',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Perplexity AI',
                    'https://api.perplexity.ai',
                    key ?? process.env.PERPLEXITY_API_KEY ?? '',
                    'perplexity',
                ),
        },
        {
            provider: 'cohere',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Cohere',
                    'https://api.cohere.com',
                    key ?? process.env.COHERE_API_KEY ?? '',
                    'cohere',
                ),
        },
        {
            provider: 'huggingface',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Hugging Face',
                    'https://api-inference.huggingface.co',
                    key ?? process.env.HF_API_KEY ?? '',
                    'huggingface',
                ),
        },
        {
            provider: 'zhipu',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Zhipu AI',
                    'https://api.z.ai/api/openai',
                    key ?? process.env.ZHIPU_API_KEY ?? '',
                    'zhipu',
                ),
        },
        {
            provider: 'moonshot',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Moonshot (Kimi)',
                    'https://api.moonshot.cn',
                    key ?? process.env.MOONSHOT_API_KEY ?? '',
                    'moonshot',
                ),
        },
        { provider: 'lmstudio', fetch: fetchLMStudio },
        {
            provider: 'xai',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'xAI',
                    'https://api.x.ai',
                    key ?? process.env.XAI_API_KEY ?? '',
                    'xai',
                ),
        },
        {
            provider: 'minimax',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'MiniMax',
                    'https://api.minimax.io',
                    key ?? process.env.MINIMAX_API_KEY ?? '',
                    'minimax',
                ),
        },
        {
            provider: 'sambanova',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'SambaNova',
                    'https://api.sambanova.ai',
                    key ?? process.env.SAMBANOVA_API_KEY ?? '',
                    'sambanova',
                ),
        },
        {
            provider: 'siliconflow',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'SiliconFlow',
                    'https://api.siliconflow.cn',
                    key ?? process.env.SILICONFLOW_API_KEY ?? '',
                    'siliconflow',
                ),
        },
        {
            provider: 'deepinfra',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'DeepInfra',
                    'https://api.deepinfra.com/v1/openai',
                    key ?? process.env.DEEPINFRA_API_TOKEN ?? '',
                    'deepinfra',
                ),
        },
        {
            provider: 'novita',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Novita AI',
                    'https://api.novita.ai/v3/openai',
                    key ?? process.env.NOVITA_API_KEY ?? '',
                    'novita',
                ),
        },
        {
            provider: 'nebius',
            fetch: (key) =>
                fetchOpenAICompatible(
                    'Nebius',
                    'https://api.studio.nebius.ai',
                    key ?? process.env.NEBIUS_API_KEY ?? '',
                    'nebius',
                ),
        },
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
