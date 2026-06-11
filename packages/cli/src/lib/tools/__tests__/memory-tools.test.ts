import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

describe("Memory Tools", () => {
    const MEMORY_FILE = join(homedir(), ".nightcode", "memory", "global.json");

    beforeEach(async () => {
        try { unlinkSync(MEMORY_FILE); } catch {}
        try { unlinkSync(`${MEMORY_FILE}.lock`); } catch {}
    });

    afterEach(() => {
        try { unlinkSync(MEMORY_FILE); } catch {}
        try { unlinkSync(`${MEMORY_FILE}.lock`); } catch {}
    });

    it("sets and gets a value", async () => {
        const { memorySetTool, memoryGetTool } = await import("../memory");
        const setResult = await memorySetTool({ key: "test-key", value: "test-value" });
        expect(setResult.output).toContain("Stored");

        const getResult = await memoryGetTool({ key: "test-key" });
        expect(getResult.output).toContain("test-value");
    });

    it("deletes a value", async () => {
        const { memorySetTool, memoryGetTool, memoryDeleteTool } = await import("../memory");
        await memorySetTool({ key: "to-delete", value: "value" });

        const deleteResult = await memoryDeleteTool({ key: "to-delete" });
        expect(deleteResult.output).toContain("Deleted");

        const getResult = await memoryGetTool({ key: "to-delete" });
        expect(getResult.output).toContain("No memory found");
    });

    it("lists entries", async () => {
        const { memorySetTool, memoryListTool } = await import("../memory");
        await memorySetTool({ key: "key-a", value: "value-a" });
        await memorySetTool({ key: "key-b", value: "value-b" });

        const listResult = await memoryListTool({ tag: undefined });
        expect(listResult.output).toContain("key-a");
        expect(listResult.output).toContain("key-b");
    });

    it("searches entries", async () => {
        const { memorySetTool, memorySearchTool } = await import("../memory");
        await memorySetTool({ key: "api-endpoint", value: "https://api.example.com" });

        const searchResult = await memorySearchTool({ query: "api" });
        expect(searchResult.output).toContain("api-endpoint");
    });
});
