import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debug } from "../debug";
import * as fsPromises from "fs/promises";

vi.mock("fs/promises", () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("DebugLogger rotateLogs", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps only logs with valid timestamps within the retention period", async () => {
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const validRecent = { timestamp: new Date(now - oneDayMs).toISOString(), level: "LOG", category: "test", message: "recent" };
        const validOld = { timestamp: new Date(now - 10 * oneDayMs).toISOString(), level: "LOG", category: "test", message: "old" };
        const invalidTimestampType = { timestamp: {} as any, level: "LOG", category: "test", message: "invalid type" };
        const invalidTimestampString = { timestamp: "not-a-date", level: "LOG", category: "test", message: "invalid string" };
        const missingTimestamp = { level: "LOG", category: "test", message: "missing ts" };

        const fileContent = [
            JSON.stringify(validRecent),
            JSON.stringify(validOld),
            JSON.stringify(invalidTimestampType),
            JSON.stringify(invalidTimestampString),
            JSON.stringify(missingTimestamp),
        ].join("\n") + "\n";

        vi.mocked(fsPromises.readFile).mockResolvedValue(fileContent);

        const writeSpy = vi.mocked(fsPromises.writeFile);

        // Rotate logs with 7-day retention
        await debug.rotateLogs(7);

        expect(writeSpy).toHaveBeenCalled();
        const writtenContent = writeSpy.mock.calls[0]![1] as string;
        const writtenLines = writtenContent.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));

        // Should only contain validRecent because:
        // - validRecent is within 7 days
        // - validOld is older than 7 days
        // - others have invalid/missing timestamps
        expect(writtenLines.length).toBe(1);
        expect(writtenLines[0]).toEqual(validRecent);
    });
});
