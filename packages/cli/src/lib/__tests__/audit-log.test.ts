import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auditLog } from "../audit-log";
import * as fsPromises from "fs/promises";

vi.mock("fs/promises", () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("AuditLogger", () => {
    let errorSpy: any;

    beforeEach(async () => {
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await auditLog.destroy(); // Ensure clean state
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await auditLog.destroy();
    });

    it("surfaces flush failure during destroy() via the logger", async () => {
        const testError = new Error("Disk full");
        vi.mocked(fsPromises.appendFile).mockRejectedValueOnce(testError);

        // Put something in the buffer
        await auditLog.log({
            sessionId: "test-session",
            tool: "bash",
            input: "ls -la",
            duration: 100,
            success: true,
        });

        // Trigger destroy and expect it to handle the failure and log it
        await auditLog.destroy();

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Final audit flush failed"),
            testError
        );
    });

    it("successfully flushes entries on destroy()", async () => {
        vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);

        await auditLog.log({
            sessionId: "test-session",
            tool: "bash",
            input: "ls -la",
            duration: 100,
            success: true,
        });

        await auditLog.destroy();

        expect(fsPromises.appendFile).toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("redacts and flushes circular inputs without throwing", async () => {
        vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
        const input: Record<string, unknown> = { apiKey: "secret-value-123" };
        input.self = input;

        await auditLog.log({
            sessionId: "test-session",
            tool: "bash",
            input,
            output: "ok",
            duration: 100,
            success: true,
        });

        await auditLog.destroy();

        const written = vi.mocked(fsPromises.appendFile).mock.calls.at(-1)?.[1] as string;
        expect(written).toContain("[REDACTED]");
        expect(written).toContain("[Circular]");
    });
});
