import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunGit = vi.fn();
vi.mock("../utils", () => ({
    MAX_DIFF: 50_000,
    runGit: (...args: any[]) => mockRunGit(...args),
}));

vi.mock("@nightcode/shared", () => ({
    toolInputSchemas: {
        gitDiff: { parse: (input: any) => input },
    },
}));

import { gitStatusTool, gitDiffTool } from "../git";

describe("gitStatusTool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns status on success", async () => {
        mockRunGit.mockResolvedValue({
            stdout: "## main...origin/main\n M src/index.ts",
            stderr: "",
            exitCode: 0,
        });

        const result = await gitStatusTool();

        expect(result).toEqual({
            status: "## main...origin/main\n M src/index.ts",
        });
        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), ["status", "--short", "--branch"]);
    });

    it("returns error on failure", async () => {
        mockRunGit.mockResolvedValue({
            stdout: "",
            stderr: "fatal: not a git repository",
            exitCode: 128,
        });

        const result = await gitStatusTool();

        expect(result).toEqual({
            error: "fatal: not a git repository",
        });
    });

    it("returns generic error when stderr is empty", async () => {
        mockRunGit.mockResolvedValue({
            stdout: "",
            stderr: "",
            exitCode: 1,
        });

        const result = await gitStatusTool();

        expect(result).toEqual({ error: "git status failed" });
    });
});

describe("gitDiffTool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns unstaged diff by default", async () => {
        mockRunGit.mockResolvedValue({
            stdout: "diff --git a/src/index.ts b/src/index.ts\n+new line",
            stderr: "",
            exitCode: 0,
        });

        const result = await gitDiffTool({});

        expect(result).toEqual({
            diff: "diff --git a/src/index.ts b/src/index.ts\n+new line",
            truncated: false,
        });
        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), ["diff"]);
    });

    it("passes --cached flag for staged diffs", async () => {
        mockRunGit.mockResolvedValue({
            stdout: "staged diff content",
            stderr: "",
            exitCode: 0,
        });

        await gitDiffTool({ staged: true });

        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), ["diff", "--cached"]);
    });

    it("passes path filter when provided", async () => {
        mockRunGit.mockResolvedValue({
            stdout: "file diff",
            stderr: "",
            exitCode: 0,
        });

        await gitDiffTool({ path: "src/index.ts" });

        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), ["diff", "--", "src/index.ts"]);
    });

    it("truncates large diffs", async () => {
        const hugeDiff = "x".repeat(60_000);
        mockRunGit.mockResolvedValue({
            stdout: hugeDiff,
            stderr: "",
            exitCode: 0,
        });

        const result = await gitDiffTool({});

        expect(result.truncated).toBe(true);
        expect(result.diff!.length).toBeLessThan(60_000);
        expect(result.diff).toContain("truncated");
    });

    it("returns error on git failure", async () => {
        mockRunGit.mockResolvedValue({
            stdout: "",
            stderr: "fatal: bad revision",
            exitCode: 128,
        });

        const result = await gitDiffTool({});

        expect(result).toEqual({ error: "fatal: bad revision" });
    });
});
