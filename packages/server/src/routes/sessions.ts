import { z } from "zod";
import { Hono } from "hono";

import { db } from "@nightcode/database/client";
import { zValidator } from "@hono/zod-validator";

import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import type { ConversationBranch } from "@nightcode/shared";

const createSessionSchema = z.object({
    title: z.string(),
});

const createSessionValidator = zValidator(
    "json",
    createSessionSchema,
    (result, c) => {
        if (!result.success) {
            return c.json({ error: "Invalid request body" }, 400);
        }
    }
);

const updateSessionSchema = z.object({
    title: z.string(),
});

const updateSessionValidator = zValidator(
    "json",
    updateSessionSchema,
    (result, c) => {
        if (!result.success) {
            return c.json({ error: "Invalid request body" }, 400);
        }
    }
);

const app = new Hono<AuthenticatedEnv>()
    .get("/", async (c) => {
        const userId = c.get("userId");
        const limit = Math.min(Number(c.req.query("limit")) || 100, 200);
        const cursor = c.req.query("cursor");

        const sessions = await db.session.findMany({
            where: { userId, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: {
                id: true,
                title: true,
                createdAt: true,
            }
        });

        return c.json(sessions);
    })
    .get("/:id", async (c) => {
        const id = c.req.param("id");
        const userId = c.get("userId");

        const session = await db.session.findUnique({
            where: { id, userId },
        });
        if (!session) {
            return c.json({ error: "Session not found" }, 404);
        }

        return c.json(session);
    })
    .post("/", requireCreditsBalance, createSessionValidator, async (c) => {
        const userId = c.get("userId");
        const data = c.req.valid("json");

        const session = await db.session.create({
            data: {
                ...data,
                userId,
            },
        });

        return c.json(session, 201);
    })
    .patch("/:id", updateSessionValidator, async (c) => {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { title } = c.req.valid("json");

        try {
            const session = await db.session.update({
                where: { id, userId },
                data: { title },
                select: { id: true, title: true },
            });

            return c.json(session);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === "P2025") {
                return c.json({ error: "Session not found" }, 404);
            }
            throw err;
        }
    })

    // ─── Branch routes ──────────────────────────────────────────────────────

    .get("/:id/branches", async (c) => {
        const id = c.req.param("id");
        const userId = c.get("userId");

        const session = await db.session.findUnique({
            where: { id, userId },
            select: { branches: true, activeBranchId: true },
        });
        if (!session) {
            return c.json({ error: "Session not found" }, 404);
        }

        return c.json({
            branches: (session.branches as unknown as ConversationBranch[]) ?? [],
            activeBranchId: (session.activeBranchId as string) ?? "main",
        });
    })

    .post(
        "/:id/branches",
        zValidator("json", z.object({
            parentMessageIndex: z.number().int().min(0),
            name: z.string().optional(),
        }), (result, c) => {
            if (!result.success) {
                return c.json({ error: "Invalid request body" }, 400);
            }
        }),
        async (c) => {
            const id = c.req.param("id");
            const userId = c.get("userId");
            const { parentMessageIndex, name } = c.req.valid("json");

            const session = await db.session.findUnique({
                where: { id, userId },
                select: { branches: true, activeBranchId: true },
            });
            if (!session) {
                return c.json({ error: "Session not found" }, 404);
            }

            const branches = (session.branches as unknown as ConversationBranch[]) ?? [];
            const autoName = `Branch ${branches.length + 1}`;
            const newBranch: ConversationBranch = {
                id: crypto.randomUUID(),
                parentBranchId: (session.activeBranchId as string) ?? "main",
                parentMessageIndex,
                name: name ?? autoName,
                createdAt: new Date().toISOString(),
            };

            const updatedBranches = [...branches, newBranch];

            await db.session.update({
                where: { id, userId },
                data: {
                    branches: updatedBranches as any,
                    activeBranchId: newBranch.id,
                },
            });

            return c.json(newBranch, 201);
        }
    )

    .put(
        "/:id/active-branch",
        zValidator("json", z.object({
            branchId: z.string(),
        }), (result, c) => {
            if (!result.success) {
                return c.json({ error: "Invalid request body" }, 400);
            }
        }),
        async (c) => {
            const id = c.req.param("id");
            const userId = c.get("userId");
            const { branchId } = c.req.valid("json");

            const session = await db.session.findUnique({
                where: { id, userId },
                select: { branches: true },
            });
            if (!session) {
                return c.json({ error: "Session not found" }, 404);
            }

            if (branchId !== "main") {
                const branches = (session.branches as unknown as ConversationBranch[]) ?? [];
                const exists = branches.some((b) => b.id === branchId);
                if (!exists) {
                    return c.json({ error: "Branch not found" }, 404);
                }
            }

            await db.session.update({
                where: { id, userId },
                data: { activeBranchId: branchId },
            });

            return c.json({ branchId });
        }
    )

    .delete("/:id/branches/:branchId", async (c) => {
        const id = c.req.param("id");
        const branchId = c.req.param("branchId");
        const userId = c.get("userId");

        if (branchId === "main") {
            return c.json({ error: "Cannot delete the main branch" }, 400);
        }

        const session = await db.session.findUnique({
            where: { id, userId },
            select: { branches: true, activeBranchId: true },
        });
        if (!session) {
            return c.json({ error: "Session not found" }, 404);
        }

        const branches = (session.branches as unknown as ConversationBranch[]) ?? [];
        const filtered = branches.filter((b) => b.id !== branchId);

        if (filtered.length === branches.length) {
            return c.json({ error: "Branch not found" }, 404);
        }

        const newActiveBranch =
            (session.activeBranchId as string) === branchId
                ? "main"
                : session.activeBranchId;

        await db.session.update({
            where: { id, userId },
            data: {
                branches: filtered as any,
                activeBranchId: newActiveBranch,
            },
        });

        return c.json({ deleted: branchId });
    });

export default app;
