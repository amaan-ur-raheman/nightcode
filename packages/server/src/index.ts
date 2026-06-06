import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

import auth from './routes/auth';
import chat from './routes/chat';
import sessions from './routes/sessions';
import billing from './routes/billing';
import subagent from './routes/subagent';
import { requireAuth } from './middleware/require-auth';

const app = new Hono();

app.get("/debug-sentry", () => {
    throw new Error("My first Sentry error!");
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
app.use("/subagent/*", requireAuth);

const routes = app
    .route("/auth", auth)
    .route("/billing", billing)
    .route("/sessions", sessions)
    .route("/chat", chat)
    .route("/subagent", subagent);

export type AppType = typeof routes;

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
export default { port, fetch: app.fetch, idleTimeout: 255 };
