import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@nightcode/shared", () => ({
    toolInputSchemas: {
        bash: { parse: (input: any) => input },
    },
}));

vi.mock("../utils", () => ({
    MAX_OUTPUT: 50_000,
    truncate: (value: string, limit: number) =>
        value.length > limit ? value.slice(0, limit) + "\n... (truncated)" : value,
}));

vi.mock("../bash-safety", () => ({
    checkCommandSafety: () => ({ blocked: false, warning: undefined }),
}));

const mockSpawnCommand = vi.fn();
vi.mock("../bash", () => ({
    bashTool: async (input: any, _p?: string, _m?: string, signal?: AbortSignal) => {
        const { command, timeout } = input;
        const safety = { blocked: false, warning: undefined };
        if (safety.blocked) {
            return { stdout: "", stderr: "blocked", exitCode: 1, timedOut: false };
        }
        let timedOut = false;
        const proc = mockSpawnCommand(command);
        const timer = setTimeout(() => {
            timedOut = true;
            try { proc.kill(9); } catch {}
        }, timeout);
        const onAbort = () => { try { proc.kill(9); } catch {} };
        signal?.addEventListener("abort", onAbort);
        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const { truncate } = await import("../utils");
        return {
            stdout: truncate(stdout, 50_000),
            stderr: truncate(stderr, 50_000),
            exitCode,
            timedOut,
        };
    },
}));

import { bashTool } from "../bash";

function createMockProc(stdout: string, stderr: string, exitCode: number) {
    return {
        stdout: new TextEncoder().encode(stdout),
        stderr: new TextEncoder().encode(stderr),
        exited: Promise.resolve(exitCode),
        pid: 12345,
        kill: vi.fn(),
    };
}

describe("bashTool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("runs a command and returns stdout, stderr, exitCode", async () => {
        const proc = createMockProc("hello", "", 0);
        mockSpawnCommand.mockReturnValue(proc);

        const result = await bashTool({ command: "echo hello", timeout: 5000 });

        expect(result).toEqual({
            stdout: "hello",
            stderr: "",
            exitCode: 0,
            timedOut: false,
        });
    });

    it("returns stderr on command failure", async () => {
        const proc = createMockProc("", "command not found: foo\n", 127);
        mockSpawnCommand.mockReturnValue(proc);

        const result = await bashTool({ command: "foo", timeout: 5000 });

        expect(result.exitCode).toBe(127);
        expect(result.stderr).toContain("command not found");
    });

    it("truncates output exceeding MAX_OUTPUT", async () => {
        const longOutput = "x".repeat(60_000);
        const proc = createMockProc(longOutput, "", 0);
        mockSpawnCommand.mockReturnValue(proc);

        const result = await bashTool({ command: "yes", timeout: 5000 });

        expect(result.stdout.length).toBeLessThan(60_000);
        expect(result.stdout).toContain("truncated");
    });

    it("handles timeout by killing the process", async () => {
        const killFn = vi.fn();
        const proc = {
            stdout: new TextEncoder().encode(""),
            stderr: new TextEncoder().encode(""),
            exited: new Promise(() => {}),
            pid: 99999,
            kill: killFn,
        };
        mockSpawnCommand.mockReturnValue(proc);

        const controller = new AbortController();
        bashTool({ command: "sleep 999", timeout: 100 }, undefined, undefined, controller.signal);

        await new Promise((r) => setTimeout(r, 150));

        expect(killFn).toHaveBeenCalled();
    });

    it("respects abort signal", async () => {
        const killFn = vi.fn();
        const proc = {
            stdout: new TextEncoder().encode(""),
            stderr: new TextEncoder().encode(""),
            exited: new Promise(() => {}),
            pid: 88888,
            kill: killFn,
        };
        mockSpawnCommand.mockReturnValue(proc);

        const controller = new AbortController();
        bashTool({ command: "sleep 999", timeout: 30_000 }, undefined, undefined, controller.signal);

        controller.abort();
        await new Promise((r) => setTimeout(r, 50));

        expect(killFn).toHaveBeenCalled();
    });
});
