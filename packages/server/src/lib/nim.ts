import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const apiKey = process.env.NIM_API_KEY;
if (!apiKey) {
    throw new Error("NIM_API_KEY environment variable is not set");
}

export const nim = createOpenAICompatible({
    name: "nim",
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey,
});
