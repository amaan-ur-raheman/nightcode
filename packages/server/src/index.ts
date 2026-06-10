import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

import auth from './routes/auth';
import chat from './routes/chat';
import sessions from './routes/sessions';
import billing from './routes/billing';
import subagent from './routes/subagent';
import exportRoutes from './routes/export';
import { requireAuth } from './middleware/require-auth';
import { serverDebug } from './lib/debug';

const app = new Hono();

app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const path = c.req.path;
    const status = c.res.status;
    serverDebug.log("http", `${c.req.method} ${path} ${status} ${duration}ms`);
    if (duration > 1000 || status >= 500) {
        console.log(`${c.req.method} ${path} ${status} ${duration}ms`);
    }
});

app.onError((error, c) => {
    console.error("Unhandled server error:", error);
    if (error instanceof HTTPException) {
        return c.json({ error: error.message || "Request failed" }, error.status);
    }
    return c.json({ error: "Internal server error" }, 500);
});

app.use("/chat/*", requireAuth);
app.use("/sessions/*", requireAuth);
app.use("/billing/checkout", requireAuth);
app.use("/billing/portal", requireAuth);
app.use("/billing/credits", requireAuth);
app.use("/subagent/*", requireAuth);
app.use("/export/*", requireAuth);

const routes = app
    .route("/auth", auth)
    .route("/billing", billing)
    .route("/sessions", sessions)
    .route("/chat", chat)
    .route("/subagent", subagent)
    .route("/export", exportRoutes);

export type AppType = typeof routes;

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
export default { port, fetch: app.fetch, idleTimeout: 255 };
