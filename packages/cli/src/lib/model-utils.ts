import {
    findSupportedChatModel,
    type AgentRole as SharedAgentRole,
} from '@nightcode/shared';

/**
 * Agent roles that can be spawned as subagents.
 * Extends the shared AgentRole with preset-agent-specific roles.
 */
export type AgentRole =
    | SharedAgentRole
    | 'codeReviewer'
    | 'testWriter'
    | 'refactor';

/**
 * Provider-specific fallback model maps.
 * Each provider maps agent roles to lightweight, appropriate models.
 * These are used when no model is specified AND no parent model is available.
 */
// All roles map to a fallback model. Uses Record<string, string> so unknown roles gracefully fall back to "coder".
type ProviderModelMap = Record<string, string>;

/**
 * Free model fallbacks per provider.
 * Used when no parentModel is available — prefers free models to avoid unnecessary cost.
 * Falls back to PROVIDER_FALLBACKS (paid) only when no free option exists for the provider.
 */
const PROVIDER_FREE_FALLBACKS: Record<string, ProviderModelMap> = {
    opencode: {
        coder: 'opencode/north-mini-code-free',
        reviewer: 'opencode/deepseek-v4-flash-free',
        tester: 'opencode/deepseek-v4-flash-free',
        researcher: 'opencode/deepseek-v4-flash-free',
        debugger: 'opencode/north-mini-code-free',
        orchestrator: 'opencode/deepseek-v4-flash-free',
        codeReviewer: 'opencode/north-mini-code-free',
        testWriter: 'opencode/deepseek-v4-flash-free',
        refactor: 'opencode/north-mini-code-free',
    },
    // nvidia: all models are already free, so PROVIDER_FALLBACKS is used as-is
    // anthropic/openai/groq: no free models available, so PROVIDER_FALLBACKS (paid) is used as-is
    kilo: {
        coder: 'kilo/openai/gpt-4o-mini',
        reviewer: 'kilo/openai/gpt-4o-mini',
        tester: 'kilo/openai/gpt-4o-mini',
        researcher: 'kilo/openai/gpt-4o-mini',
        debugger: 'kilo/openai/gpt-4o-mini',
        orchestrator: 'kilo/openai/gpt-4o-mini',
        codeReviewer: 'kilo/openai/gpt-4o-mini',
        testWriter: 'kilo/openai/gpt-4o-mini',
        refactor: 'kilo/openai/gpt-4o',
    },
};

const PROVIDER_FALLBACKS: Record<string, ProviderModelMap> = {
    opencode: {
        coder: 'opencode/gpt-5.4-mini',
        reviewer: 'opencode/gpt-5.4-mini',
        tester: 'opencode/gpt-5.4-nano',
        researcher: 'opencode/gpt-5.4-nano',
        debugger: 'opencode/gpt-5.4-mini',
        orchestrator: 'opencode/gpt-5.4-mini',
        codeReviewer: 'opencode/gpt-5.4-mini',
        testWriter: 'opencode/gpt-5.4-nano',
        refactor: 'opencode/gpt-5.4',
    },
    nvidia: {
        coder: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        reviewer: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        tester: 'nvidia/stepfun-ai/step-3.7-flash',
        researcher: 'nvidia/meta/llama-3.3-70b-instruct',
        debugger: 'nvidia/moonshotai/kimi-k2.6',
        orchestrator: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        codeReviewer: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        testWriter: 'nvidia/stepfun-ai/step-3.7-flash',
        refactor: 'nvidia/nemotron-3-ultra-550b-a55b',
    },
    anthropic: {
        coder: 'claude-3-5-haiku-20241022',
        reviewer: 'claude-3-5-haiku-20241022',
        tester: 'claude-3-5-haiku-20241022',
        researcher: 'claude-3-5-haiku-20241022',
        debugger: 'claude-3-5-haiku-20241022',
        orchestrator: 'claude-3-5-haiku-20241022',
        codeReviewer: 'claude-3-5-haiku-20241022',
        testWriter: 'claude-3-5-haiku-20241022',
        refactor: 'claude-sonnet-4-20250514',
    },
    openai: {
        coder: 'gpt-4o-mini',
        reviewer: 'gpt-4o-mini',
        tester: 'gpt-4o-mini',
        researcher: 'gpt-4o-mini',
        debugger: 'gpt-4o-mini',
        orchestrator: 'gpt-4o-mini',
        codeReviewer: 'gpt-4o-mini',
        testWriter: 'gpt-4o-mini',
        refactor: 'gpt-4o',
    },
    groq: {
        coder: 'mixtral-8x7b-32768',
        reviewer: 'mixtral-8x7b-32768',
        tester: 'mixtral-8x7b-32768',
        researcher: 'mixtral-8x7b-32768',
        debugger: 'llama-3.3-70b-versatile',
        orchestrator: 'mixtral-8x7b-32768',
        codeReviewer: 'mixtral-8x7b-32768',
        testWriter: 'mixtral-8x7b-32768',
        refactor: 'llama-3.3-70b-versatile',
    },
    kilo: {
        coder: 'kilo/openai/gpt-4o-mini',
        reviewer: 'kilo/openai/gpt-4o-mini',
        tester: 'kilo/openai/gpt-4o-mini',
        researcher: 'kilo/openai/gpt-4o-mini',
        debugger: 'kilo/openai/gpt-4o-mini',
        orchestrator: 'kilo/openai/gpt-4o-mini',
        codeReviewer: 'kilo/openai/gpt-4o-mini',
        testWriter: 'kilo/openai/gpt-4o-mini',
        refactor: 'kilo/openai/gpt-4o',
    },
};

const DEFAULT_PROVIDER = 'nvidia';

/**
 * Extract the provider from a model ID string.
 * Uses the shared model registry for known models, or infers from prefix.
 */
export function extractProvider(modelId: string): string {
    const model = findSupportedChatModel(modelId);
    if (model) return model.provider;

    if (modelId.startsWith('opencode/')) return 'opencode';
    if (modelId.startsWith('kilo/')) return 'kilo';
    if (modelId.startsWith('local/')) return 'local';
    if (modelId.startsWith('zenmux/')) return 'zenmux';
    if (modelId.startsWith('mistral/')) return 'mistral';
    if (modelId.startsWith('qwen/')) return 'qwen';
    if (modelId.startsWith('perplexity/')) return 'perplexity';
    if (modelId.startsWith('cohere/')) return 'cohere';
    if (modelId.startsWith('huggingface/')) return 'huggingface';
    if (modelId.startsWith('zhipu/')) return 'zhipu';
    if (modelId.startsWith('moonshot/')) return 'moonshot';
    if (modelId.startsWith('lmstudio/')) return 'lmstudio';
    if (modelId.startsWith('xai/')) return 'xai';
    if (modelId.startsWith('minimax/')) return 'minimax';
    if (modelId.startsWith('sambanova/')) return 'sambanova';
    if (modelId.startsWith('siliconflow/')) return 'siliconflow';
    if (modelId.startsWith('deepinfra/')) return 'deepinfra';
    if (modelId.startsWith('novita/')) return 'novita';
    if (modelId.startsWith('nebius/')) return 'nebius';
    if (modelId.startsWith('claude-')) return 'anthropic';
    if (modelId.startsWith('gpt-') || modelId.startsWith('o3')) return 'openai';
    if (modelId.startsWith('llama-') || modelId.startsWith('mixtral-'))
        return 'groq';

    return DEFAULT_PROVIDER;
}

/**
 * Resolve a fallback model for a subagent/worker based on the user's selected model.
 *
 * Priority:
 * 1. AI's explicit model choice (handled by caller before calling this)
 * 2. User's selected model (parentModel) — used as-is by the caller
 * 3. Free provider-matched fallback (this function) — picks a free model from the same provider
 * 4. Paid provider-matched fallback — only when no free model exists for the provider
 * 5. Global default (nvidia, already free)
 *
 * @param parentModel - The user's currently selected model ID
 * @param role - The agent role (coder, reviewer, tester, etc.)
 * @returns A model ID from the same provider, suitable for the given role
 */
const DEFAULT_FALLBACKS = PROVIDER_FALLBACKS[DEFAULT_PROVIDER]!;
const DEFAULT_FREE_FALLBACKS =
    PROVIDER_FREE_FALLBACKS[DEFAULT_PROVIDER] ?? DEFAULT_FALLBACKS;
const CODER_FALLBACK =
    DEFAULT_FREE_FALLBACKS['coder'] ??
    DEFAULT_FALLBACKS['coder'] ??
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';

export function resolveProviderFallback(
    parentModel: string | undefined,
    role: AgentRole,
): string {
    if (!parentModel) {
        // No parent model — prefer free fallback, then paid, then coder role
        return (
            DEFAULT_FREE_FALLBACKS[role] ??
            DEFAULT_FALLBACKS[role] ??
            CODER_FALLBACK
        );
    }

    const provider = extractProvider(parentModel);

    // Check for free fallback first
    const freeMap = PROVIDER_FREE_FALLBACKS[provider];
    if (freeMap) {
        return freeMap[role] ?? freeMap['coder'] ?? CODER_FALLBACK;
    }

    // Fall back to paid models (for providers with no free options)
    const paidMap = PROVIDER_FALLBACKS[provider];
    if (paidMap) {
        return paidMap[role] ?? paidMap['coder'] ?? CODER_FALLBACK;
    }

    return CODER_FALLBACK;
}
