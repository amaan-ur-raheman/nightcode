import { describe, it, expect, vi } from "vitest";

vi.mock("../providers", () => ({
    getProviderName: (modelId: string) => {
        if (modelId.startsWith("claude") || modelId.includes("anthropic")) return "anthropic";
        if (modelId.startsWith("gpt") || modelId.startsWith("o3")) return "openai";
        if (modelId.includes("llama-3.3-70b-versatile") || modelId.includes("mixtral")) return "groq";
        return "nim";
    },
    isModelAvailable: async (modelId: string) => true,
}));

import { getFallbackChain, withFallback } from "../fallback";

describe("getFallbackChain", () => {
    it("returns NIM fallbacks for NIM models", () => {
        const chain = getFallbackChain("deepseek-ai/deepseek-v4-pro");
        expect(chain).toEqual([
            "deepseek-ai/deepseek-v4-pro",
            "qwen/qwen3.5-397b-a17b",
            "meta/llama-3.3-70b-instruct",
        ]);
    });

    it("returns Anthropic fallbacks for Anthropic models", () => {
        const chain = getFallbackChain("claude-sonnet-4-20250514");
        expect(chain).toEqual([
            "gpt-4o",
            "nvidia/nemotron-3-ultra-550b-a55b",
        ]);
    });

    it("returns OpenAI fallbacks for OpenAI models", () => {
        const chain = getFallbackChain("gpt-4o");
        expect(chain).toEqual([
            "claude-sonnet-4-20250514",
            "nvidia/nemotron-3-ultra-550b-a55b",
        ]);
    });

    it("returns Groq fallbacks for Groq models", () => {
        const chain = getFallbackChain("llama-3.3-70b-versatile");
        expect(chain).toEqual([
            "nvidia/nemotron-3-ultra-550b-a55b",
            "deepseek-ai/deepseek-v4-pro",
        ]);
    });

    it("defaults to NIM chain for unknown providers", () => {
        const chain = getFallbackChain("unknown/model-id");
        expect(chain).toEqual([
            "deepseek-ai/deepseek-v4-pro",
            "qwen/qwen3.5-397b-a17b",
            "meta/llama-3.3-70b-instruct",
        ]);
    });
});

describe("withFallback", () => {
    it("returns result on first attempt if primary succeeds", async () => {
        const fn = vi.fn().mockResolvedValue("success");

        const result = await withFallback(fn, "primary-model");

        expect(result.result).toBe("success");
        expect(result.modelUsed).toBe("primary-model");
        expect(result.fallbackTriggered).toBe(false);
        expect(result.note).toBeUndefined();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith("primary-model");
    });

    it("tries next model on failure", async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error("rate limit exceeded"))
            .mockResolvedValueOnce("fallback-success");

        const result = await withFallback(fn, "primary-model");

        expect(result.result).toBe("fallback-success");
        expect(result.fallbackTriggered).toBe(true);
        expect(result.note).toContain("fallback");
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("stops on auth errors (401/403)", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("401 unauthorized"));

        await expect(withFallback(fn, "primary-model")).rejects.toThrow("401 unauthorized");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("stops on 403 forbidden errors", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("403 forbidden"));

        await expect(withFallback(fn, "primary-model")).rejects.toThrow("403 forbidden");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("stops on 'invalid api key' errors", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("invalid api key"));

        await expect(withFallback(fn, "primary-model")).rejects.toThrow("invalid api key");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("throws last error after exhausting retries", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("server error"));

        await expect(withFallback(fn, "primary-model", 1)).rejects.toThrow("server error");
        // primary + 1 retry = 2 calls
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("respects maxRetries parameter", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("timeout"));

        await expect(withFallback(fn, "primary", 0)).rejects.toThrow("timeout");
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
