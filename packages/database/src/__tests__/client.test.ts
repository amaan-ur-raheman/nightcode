import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Database Client", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearStores();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("throws if DATABASE_URL is not set", async () => {
        delete process.env.DATABASE_URL;
        await expect(async () => {
            await import("../client");
        }).rejects.toThrow();
    });

    it("exports db instance when DATABASE_URL is set", async () => {
        process.env.DATABASE_URL = "postgresql://localhost:5432/test";
        // This will try to connect, so we mock PrismaClient
        vi.doMock("@prisma/adapter-pg", () => ({
            PrismaPg: class {
                constructor(_opts: any) {}
            },
        }));
        vi.doMock("../../generated/prisma/client.ts", () => ({
            PrismaClient: class {
                constructor(_opts: any) {}
            },
        }));
        const mod = await import("../client");
        expect(mod.db).toBeDefined();
    });
});
