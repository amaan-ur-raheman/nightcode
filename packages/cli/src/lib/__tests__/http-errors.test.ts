import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../http-errors";

describe("getErrorMessage", () => {
    it("extracts error message from JSON response", async () => {
        const response = {
            json: async () => ({ error: "Session not found" }),
            status: 404,
            statusText: "Not Found",
        };
        const message = await getErrorMessage(response as any);
        expect(message).toBe("Session not found");
    });

    it("falls back to statusText when JSON has no error field", async () => {
        const response = {
            json: async () => ({ message: "Something failed" }),
            status: 500,
            statusText: "Internal Server Error",
        };
        const message = await getErrorMessage(response as any);
        expect(message).toBe("Internal Server Error");
    });

    it("falls back to statusText when JSON parsing fails", async () => {
        const response = {
            json: async () => { throw new Error("Invalid JSON"); },
            status: 400,
            statusText: "Bad Request",
        };
        const message = await getErrorMessage(response as any);
        expect(message).toBe("Bad Request");
    });

    it("handles empty error string", async () => {
        const response = {
            json: async () => ({ error: "" }),
            status: 403,
            statusText: "Forbidden",
        };
        const message = await getErrorMessage(response as any);
        expect(message).toBe("Forbidden");
    });

    it("falls back to generic message when statusText is also empty", async () => {
        const response = {
            json: async () => { throw new Error(); },
            status: 0,
            statusText: "",
        };
        const message = await getErrorMessage(response as any);
        expect(message).toBe("Response failed with status 0");
    });
});
