import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

function createNimProvider(apiKey: string) {
    return createOpenAICompatible({
        name: "nim",
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey,
    });
}

export function nim(modelId: string) {
    const apiKey = process.env.NIM_API_KEY;
    if (!apiKey) throw new Error("NIM_API_KEY environment variable is not set");
    return createNimProvider(apiKey)(modelId);
}

export function nimSubagent(modelId: string) {
    const apiKey = process.env.NIM_API_KEY_SUBAGENT ?? process.env.NIM_API_KEY;
    if (!apiKey) throw new Error("NIM_API_KEY environment variable is not set");
    return createNimProvider(apiKey)(modelId);
}
