import { describe, it, expect } from "vitest";
import { getModelName } from "../model-names";

describe("getModelName", () => {
    it("returns friendly name for known NIM models", () => {
        expect(getModelName("nvidia/nemotron-3-ultra-550b-a55b")).toBe("Nemotron 3 Ultra 550B");
        expect(getModelName("deepseek-ai/deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
        expect(getModelName("qwen/qwen3.5-397b-a17b")).toBe("Qwen 3.5 397B");
    });

    it("returns friendly name for known Anthropic models", () => {
        expect(getModelName("claude-sonnet-4-20250514")).toBe("Claude Sonnet 4");
        expect(getModelName("claude-3-5-haiku-20241022")).toBe("Claude 3.5 Haiku");
    });

    it("returns friendly name for known OpenAI models", () => {
        expect(getModelName("gpt-4o")).toBe("GPT-4o");
        expect(getModelName("gpt-4o-mini")).toBe("GPT-4o Mini");
        expect(getModelName("o3-mini")).toBe("o3-mini");
    });

    it("returns friendly name for known Groq models", () => {
        expect(getModelName("llama-3.3-70b-versatile")).toBe("Llama 3.3 70B");
        expect(getModelName("mixtral-8x7b-32768")).toBe("Mixtral 8x7B");
    });

    it("returns raw ID for unknown models", () => {
        expect(getModelName("some-unknown/model-v1")).toBe("some-unknown/model-v1");
        expect(getModelName("custom-model")).toBe("custom-model");
    });

    it("returns the ID itself when it matches no known model", () => {
        const randomId = "vendor/new-model-2026";
        expect(getModelName(randomId)).toBe(randomId);
    });
});
