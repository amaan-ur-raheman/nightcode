import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "fs/promises";

vi.mock("fs/promises", () => ({
    readFile: vi.fn(),
}));

describe("generateDiffPreview", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns '(no changes)' when content is identical", async () => {
        vi.mocked(readFile).mockResolvedValue("same content");
        const { generateDiffPreview } = await import("../file-diff");
        const result = await generateDiffPreview("/path/file.ts", "same content");
        expect(result).toBe("(no changes)");
    });

    it("returns '(new file)' when old file doesn't exist", async () => {
        vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
        const { generateDiffPreview } = await import("../file-diff");
        const result = await generateDiffPreview("/path/new-file.ts", "new content");
        expect(result).toBe("(new file)");
    });

    it("generates diff for changed content", async () => {
        vi.mocked(readFile).mockResolvedValue("line1\nline2\nline3");
        const { generateDiffPreview } = await import("../file-diff");
        const result = await generateDiffPreview("/path/file.ts", "line1\nmodified\nline3");
        expect(result).toContain("--- a/");
        expect(result).toContain("+++ b/");
        expect(result).toContain("-line2");
        expect(result).toContain("+modified");
    });
});
