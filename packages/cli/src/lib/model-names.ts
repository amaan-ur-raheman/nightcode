const MODEL_NAMES: Record<string, string> = {
    // ── NVIDIA NIM ──
    "nvidia/nemotron-3-ultra-550b-a55b":              "Nemotron 3 Ultra 550B",
    "stepfun-ai/step-3.7-flash":                      "Step 3.7 Flash",
    "moonshotai/kimi-k2.6":                           "Kimi K2.6",
    "mistralai/mistral-medium-3.5-128b":              "Mistral Medium 3.5",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning":  "Nemotron 3 Nano 30B",
    "deepseek-ai/deepseek-v4-flash":                  "DeepSeek V4 Flash",
    "deepseek-ai/deepseek-v4-pro":                    "DeepSeek V4 Pro",
    "z-ai/glm-5.1":                                   "GLM 5.1",
    "minimaxai/minimax-m2.7":                         "MiniMax M2.7",
    "google/gemma-4-31b-it":                          "Gemma 4 31B",
    "mistralai/mistral-small-4-119b-2603":            "Mistral Small 4",
    "nvidia/nemotron-3-super-120b-a12b":              "Nemotron 3 Super 120B",
    "qwen/qwen3.5-122b-a10b":                        "Qwen 3.5 122B",
    "qwen/qwen3.5-397b-a17b":                        "Qwen 3.5 397B",
    "stepfun-ai/step-3.5-flash":                      "Step 3.5 Flash",
    "meta/llama-4-maverick-17b-128e-instruct":        "Llama 4 Maverick",
    "meta/llama-3.3-70b-instruct":                    "Llama 3.3 70B",

    // ── Anthropic ──
    "claude-sonnet-4-20250514":                       "Claude Sonnet 4",
    "claude-3-5-haiku-20241022":                      "Claude 3.5 Haiku",

    // ── OpenAI ──
    "gpt-4o":                                         "GPT-4o",
    "gpt-4o-mini":                                    "GPT-4o Mini",
    "o3-mini":                                        "o3-mini",

    // ── Groq ──
    "llama-3.3-70b-versatile":                        "Llama 3.3 70B",
    "mixtral-8x7b-32768":                             "Mixtral 8x7B",
};

export function getModelName(modelId: string): string {
    return MODEL_NAMES[modelId] ?? modelId;
}
