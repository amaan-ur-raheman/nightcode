const MODEL_NAMES: Record<string, string> = {
    // ── NVIDIA NIM ──
    'nvidia/nemotron-3-ultra-550b-a55b': 'Nemotron 3 Ultra 550B',
    'nvidia/stepfun-ai/step-3.7-flash': 'Step 3.7 Flash',
    'nvidia/moonshotai/kimi-k2.6': 'Kimi K2.6',
    'nvidia/mistralai/mistral-medium-3.5-128b': 'Mistral Medium 3.5',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 'Nemotron 3 Nano 30B',
    'nvidia/deepseek-ai/deepseek-v4-flash': 'DeepSeek V4 Flash',
    'nvidia/deepseek-ai/deepseek-v4-pro': 'DeepSeek V4 Pro',
    'nvidia/z-ai/glm-5.1': 'GLM 5.1',
    'nvidia/minimaxai/minimax-m2.7': 'MiniMax M2.7',
    'nvidia/google/gemma-4-31b-it': 'Gemma 4 31B',
    'nvidia/mistralai/mistral-small-4-119b-2603': 'Mistral Small 4',
    'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super 120B',
    'nvidia/qwen/qwen3.5-122b-a10b': 'Qwen 3.5 122B',
    'nvidia/qwen/qwen3.5-397b-a17b': 'Qwen 3.5 397B',
    'nvidia/stepfun-ai/step-3.5-flash': 'Step 3.5 Flash',
    'nvidia/meta/llama-4-maverick-17b-128e-instruct': 'Llama 4 Maverick',
    'nvidia/meta/llama-3.3-70b-instruct': 'Llama 3.3 70B',

    // ── Anthropic ──
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',

    // ── OpenAI ──
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'o3-mini': 'o3-mini',

    // ── Groq ──
    'llama-3.3-70b-versatile': 'Llama 3.3 70B',
    'mixtral-8x7b-32768': 'Mixtral 8x7B',

    // ── OpenCode Zen (free) ──
    'opencode/deepseek-v4-flash-free': 'Zen: DeepSeek V4 Flash Free',
    'opencode/nemotron-3-ultra-free': 'Zen: Nemotron 3 Ultra Free',
    'opencode/minimax-m3-free': 'Zen: MiniMax M3 Free',
    'opencode/mimo-v2.5-free': 'Zen: MiMo V2.5 Free',
    'opencode/north-mini-code-free': 'Zen: North Mini Code Free',
    'opencode/big-pickle': 'Zen: Big Pickle',
    'opencode/qwen3.6-plus-free': 'Zen: Qwen3.6 Plus Free',

    // ── OpenCode Zen (paid) ──
    'opencode/gpt-5.5': 'Zen: GPT 5.5',
    'opencode/gpt-5.4': 'Zen: GPT 5.4',
    'opencode/gpt-5.4-mini': 'Zen: GPT 5.4 Mini',
    'opencode/gpt-5.4-nano': 'Zen: GPT 5.4 Nano',
    'opencode/gpt-5.3-codex': 'Zen: GPT 5.3 Codex',
    'opencode/gpt-5.2': 'Zen: GPT 5.2',
    'opencode/gpt-5.1-codex': 'Zen: GPT 5.1 Codex',
    'opencode/claude-opus-4-6': 'Zen: Claude Opus 4.6',
    'opencode/claude-sonnet-4-6': 'Zen: Claude Sonnet 4.6',
    'opencode/claude-haiku-4-5': 'Zen: Claude Haiku 4.5',
    'opencode/gemini-3.5-flash': 'Zen: Gemini 3.5 Flash',
    'opencode/gemini-3.1-pro': 'Zen: Gemini 3.1 Pro',
    'opencode/grok-build-0.1': 'Zen: Grok Build 0.1',
    'opencode/deepseek-v4-flash': 'Zen: DeepSeek V4 Flash',
    'opencode/kimi-k2.6': 'Zen: Kimi K2.6',
    'opencode/glm-5.1': 'Zen: GLM 5.1',
    'opencode/qwen3.6-plus': 'Zen: Qwen3.6 Plus',

    // ── xAI (Grok) ──
    'xai/grok-3': 'Grok 3',
    'xai/grok-3-mini': 'Grok 3 Mini',
    'xai/grok-3-fast': 'Grok 3 Fast',
    'xai/grok-2-1212': 'Grok 2',
    'xai/grok-code-fast-1': 'Grok Code Fast',

    // ── MiniMax ──
    'minimax/MiniMax-M3': 'MiniMax M3',
    'minimax/MiniMax-M2.7': 'MiniMax M2.7',

    // ── SambaNova ──
    'sambanova/DeepSeek-V3-0324': 'DeepSeek V3 0324 (SambaNova)',
    'sambanova/Llama-4-Maverick-17B-128E-Instruct':
        'Llama 4 Maverick (SambaNova)',
    'sambanova/QwQ-32B': 'QwQ 32B (SambaNova)',

    // ── SiliconFlow ──
    'siliconflow/Qwen/Qwen3-235B-A22B': 'Qwen3 235B (SiliconFlow)',
    'siliconflow/deepseek-ai/DeepSeek-V3': 'DeepSeek V3 (SiliconFlow)',
    'siliconflow/THUDM/GLM-4-9B-Chat': 'GLM-4 9B (SiliconFlow)',

    // ── DeepInfra ──
    'deepinfra/deepseek-ai/DeepSeek-V3-0324': 'DeepSeek V3 0324 (DeepInfra)',
    'deepinfra/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8':
        'Llama 4 Maverick (DeepInfra)',
    'deepinfra/Qwen/Qwen3-235B-A22B-Instruct-2507': 'Qwen3 235B (DeepInfra)',

    // ── Novita AI ──
    'novita/deepseek/deepseek-v3-0324': 'DeepSeek V3 0324 (Novita)',
    'novita/meta-llama/llama-4-maverick-17b-128e-instruct-fp8':
        'Llama 4 Maverick (Novita)',
    'novita/qwen/qwen3-235b-a22b-fp8': 'Qwen3 235B (Novita)',

    // ── Nebius ──
    'nebius/Qwen/Qwen3-235B-A22B': 'Qwen3 235B (Nebius)',
    'nebius/deepseek-ai/DeepSeek-V3-0324': 'DeepSeek V3 0324 (Nebius)',
    'nebius/meta-llama/Llama-4-Maverick-17B-128E-Instruct':
        'Llama 4 Maverick (Nebius)',

    // ── Cline ──
    'cline/anthropic/claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet (Cline)',
    'cline/anthropic/claude-3-5-haiku-20241022': 'Claude 3.5 Haiku (Cline)',
    'cline/openai/gpt-4o': 'GPT-4o (Cline)',
    'cline/openai/gpt-4o-mini': 'GPT-4o Mini (Cline)',
    'cline/google/gemini-2.5-pro': 'Gemini 2.5 Pro (Cline)',
    'cline/google/gemini-2.5-flash': 'Gemini 2.5 Flash (Cline)',
    'cline/minimax/minimax-m2.5': 'MiniMax M2.5 (Cline) [Free]',
    'cline/meta-llama/llama-3.1-8b-instruct:free':
        'Llama 3.1 8B (Cline) [Free]',
    'cline/qwen/qwen-2.5-coder-32b-instruct:free':
        'Qwen 2.5 Coder 32B (Cline) [Free]',
    'cline/google/gemini-2.5-flash:free': 'Gemini 2.5 Flash (Cline) [Free]',
    'cline/meta-llama/llama-3-8b-instruct:free': 'Llama 3 8B (Cline) [Free]',
    'cline/deepseek/deepseek-r1:free': 'DeepSeek R1 (Cline) [Free]',
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    nvidia: 'NVIDIA NIM',
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    groq: 'Groq',
    opencode: 'OpenCode Zen',
    openrouter: 'OpenRouter',
    together: 'Together AI',
    fireworks: 'Fireworks AI',
    cerebras: 'Cerebras',
    deepseek: 'DeepSeek',
    gemini: 'Google Gemini',
    kilo: 'Kilo Gateway',
    local: 'Local Ollama',
    lightningai: 'Lightning AI',
    cloudflare: 'Cloudflare Workers AI',
    zenmux: 'ZenMux',
    mistral: 'Mistral AI',
    qwen: 'Qwen (DashScope)',
    perplexity: 'Perplexity AI',
    cohere: 'Cohere',
    huggingface: 'Hugging Face',
    zhipu: 'Zhipu AI (GLM)',
    moonshot: 'Moonshot (Kimi)',
    lmstudio: 'LM Studio',
    xai: 'xAI (Grok)',
    minimax: 'MiniMax',
    sambanova: 'SambaNova',
    siliconflow: 'SiliconFlow',
    deepinfra: 'DeepInfra',
    novita: 'Novita AI',
    nebius: 'Nebius',
    cline: 'Cline',
};

/**
 * Derive a human-readable display name from a model ID.
 * Uses the hardcoded map if available, otherwise derives from the ID.
 */
export function deriveModelDisplayName(
    modelId: string,
    providerHint?: string,
): string {
    const known = MODEL_NAMES[modelId];
    if (known) return known;

    // Derive from ID: "openrouter/anthropic/claude-3.5-sonnet" → "Claude 3.5 Sonnet"
    const id = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    return id
        .replace(/[-_:]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Get the display name for a provider.
 */
export function getProviderDisplayName(provider: string): string {
    return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

/**
 * Extract the provider name from a model ID.
 * e.g., "opencode/deepseek-v4-flash-free" → "opencode"
 *        "openrouter/anthropic/claude-3.5-sonnet" → "openrouter"
 *        "nvidia/nemotron-3-ultra-550b-a55b" → "nvidia"
 */
export function extractProvider(modelId: string): string {
    const parts = modelId.split('/');
    if (parts.length < 2) return '';
    const prefix = parts[0]!;
    const knownProviders = [
        'opencode',
        'openrouter',
        'together',
        'fireworks',
        'cerebras',
        'deepseek',
        'gemini',
        'google',
        'kilo',
        'local',
        'lightningai',
        'cloudflare',
        'zenmux',
        'mistral',
        'qwen',
        'perplexity',
        'cohere',
        'huggingface',
        'zhipu',
        'moonshot',
        'lmstudio',
        'xai',
        'minimax',
        'sambanova',
        'siliconflow',
        'deepinfra',
        'novita',
        'nebius',
        'cline',
    ];
    if (knownProviders.includes(prefix)) return prefix;
    // NIM models: "nvidia/...", "deepseek-ai/...", "qwen/..."
    return prefix;
}

export function getModelName(modelId: string): string {
    const name = MODEL_NAMES[modelId] ?? deriveModelDisplayName(modelId);
    if (modelId.startsWith('local/')) {
        return `[Local] ${name}`;
    }
    return name;
}
