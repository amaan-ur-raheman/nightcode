import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Database Client', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('exports db instance when DATABASE_URL is set', async () => {
        process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
        vi.doMock('@prisma/adapter-pg', () => ({
            PrismaPg: class {
                constructor(_opts: any) {}
            },
        }));
        vi.doMock('../../generated/postgres/client.ts', () => ({
            PrismaClient: class {
                constructor(_opts: any) {}
            },
        }));
        const mod = await import('../client');
        expect(mod.db).toBeDefined();
    });
});
