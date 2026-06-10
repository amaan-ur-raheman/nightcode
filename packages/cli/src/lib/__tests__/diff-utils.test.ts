import { describe, it, expect } from "vitest";
import { generateDiff } from "../diff-utils";

describe("generateDiff", () => {
    it("handles identical contents correctly", () => {
        const content = "line 1\nline 2\nline 3";
        const diff = generateDiff(content, content);
        expect(diff).toEqual([
            { type: "context", content: "line 1", lineNumber: 1 },
            { type: "context", content: "line 2", lineNumber: 2 },
            { type: "context", content: "line 3", lineNumber: 3 },
        ]);
    });

    it("handles replacements correctly", () => {
        const oldContent = "line 1\nline 2\nline 3";
        const newContent = "line 1\nline 2 updated\nline 3";
        const diff = generateDiff(oldContent, newContent);
        expect(diff).toEqual([
            { type: "context", content: "line 1", lineNumber: 1 },
            { type: "remove", content: "line 2", lineNumber: 2 },
            { type: "add", content: "line 2 updated", lineNumber: 2 },
            { type: "context", content: "line 3", lineNumber: 3 },
        ]);
    });

    it("handles insertions correctly", () => {
        const oldContent = "line 1\nline 3";
        const newContent = "line 1\nline 2\nline 3";
        const diff = generateDiff(oldContent, newContent);
        expect(diff).toEqual([
            { type: "context", content: "line 1", lineNumber: 1 },
            { type: "add", content: "line 2", lineNumber: 2 },
            { type: "context", content: "line 3", lineNumber: 2 },
        ]);
    });

    it("handles deletions correctly", () => {
        const oldContent = "line 1\nline 2\nline 3";
        const newContent = "line 1\nline 3";
        const diff = generateDiff(oldContent, newContent);
        expect(diff).toEqual([
            { type: "context", content: "line 1", lineNumber: 1 },
            { type: "remove", content: "line 2", lineNumber: 2 },
            { type: "context", content: "line 3", lineNumber: 3 },
        ]);
    });
});
