import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../request-queue", () => ({
    requestQueue: {
        enqueue: async (fn: Function) => fn(),
    },
}));

vi.mock("@nightcode/shared", () => ({
    keychain: {
        isAvailable: () => false,
        getKey: async () => null,
    },
}));

vi.mock("../providers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../providers")>();
    return {
        ...actual,
        getAllModels: actual.getAllModels, // Use the actual implementation
        resetKeysResolved: actual.resetKeysResolved, // Export the new function
    };
});

describe("Server Providers", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete process.env.NIM_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.GROQ_API_KEY;
        delete process.env.OPENCODE_API_KEY;
        
        // Reset the module to re-initialize providers with clean API keys
        vi.resetModules();
    });

    it("getProviderName returns nim for unknown models when no keys set", async () => {
        const { getProviderName } = await import("../providers");
        // With no API keys set, findProviderForModel won't match anything
        // This will default to "nim" in the fallback
        const name = getProviderName("unknown-model");
        expect(name).toBe("nim");
    });

    it("getProviderName returns correct provider for known models", async () => {
        process.env.NIM_API_KEY = "test-key";
        const { getProviderName } = await import("../providers");
        expect(getProviderName("deepseek-ai/deepseek-v4-flash")).toBe("nim");
    });

    it("getAllModels returns models for providers with keys", async () => {
        process.env.NIM_API_KEY = "test-nim-key";
        const { getAllModels } = await import("../providers");
        const models = await getAllModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.every(m => m.provider === "nim")).toBe(true);
    });

    it("getAllModels returns empty array when no keys set", async () => {
        const { getAllModels } = await import("../providers");
        const models = await getAllModels();
        expect(models).toEqual([]);
    });

    it("getProviderClient throws for unknown model", async () => {
        const { getProviderClient } = await import("../providers");
        await expect(getProviderClient("unknown-model")).rejects.toThrow();
    });

    it("isModelAvailable returns false when no API key", async () => {
        const { isModelAvailable } = await import("../providers");
        const available = await isModelAvailable("deepseek-ai/deepseek-v4-flash");
        expect(available).toBe(false);
    });

    it("isModelAvailable returns true when API key is set", async () => {
        process.env.NIM_API_KEY = "test-key";
        const { isModelAvailable } = await import("../providers");
        const available = await isModelAvailable("deepseek-ai/deepseek-v4-flash");
        expect(available).toBe(true);
    });
});
