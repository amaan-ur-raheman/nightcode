import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mcpListCommand } from "../mcp";
import * as settings from "@/lib/settings";

vi.mock("@/lib/settings", () => ({
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
}));

describe("mcpListCommand", () => {
    let logSpy: any;

    beforeEach(() => {
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(settings.loadSettings).mockReturnValue({});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("logs message if no MCP servers are configured", async () => {
        await mcpListCommand();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No MCP servers configured"));
    });

    it("defensively logs valid and invalid/malformed servers without printing undefined", async () => {
        vi.mocked(settings.loadSettings).mockReturnValue({
            mcp: {
                servers: {
                    validHttp: {
                        url: "http://localhost:8080",
                    },
                    validStdio: {
                        command: "node",
                        args: ["index.js"],
                    },
                    malformedEmpty: {} as any,
                    malformedNoArgs: {
                        command: "python",
                    } as any,
                    malformedArgsNotArray: {
                        command: "ruby",
                        args: "not-an-array" as any,
                    } as any,
                },
            },
        });

        await mcpListCommand();

        // Let's assert what was logged.
        // It shouldn't log "undefined" at all.
        const allLogs = logSpy.mock.calls.map((args: any[]) => args.join(" ")).join("\n");
        expect(allLogs).not.toContain("undefined");

        // Verify validHttp
        expect(allLogs).toContain("validHttp (HTTP)");
        expect(allLogs).toContain("http://localhost:8080");

        // Verify validStdio
        expect(allLogs).toContain("validStdio (Stdio)");
        expect(allLogs).toContain("node index.js");

        // Verify malformedEmpty
        expect(allLogs).toContain("malformedEmpty (<unknown>)");
        expect(allLogs).toContain("<missing configuration>");

        // Verify malformedNoArgs
        expect(allLogs).toContain("malformedNoArgs (Stdio)");
        expect(allLogs).toContain("python");

        // Verify malformedArgsNotArray
        expect(allLogs).toContain("malformedArgsNotArray (Stdio)");
        expect(allLogs).toContain("ruby");
    });
});
