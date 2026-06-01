import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import chat from './routes/chat';
import sessions from './routes/sessions';

const app = new Hono();

app.get("/debug-sentry", () => {
    throw new Error("My first Sentry error!");
});

app.onError((error, c) => {
    if (error instanceof HTTPException) {
        return c.json({ error: error.message || "Request failed" }, error.status);
    }
    return c.json({ error: "Internal server error" }, 500);
});

const routes = app.route("/sessions", sessions).route("/chat", chat);

export type AppType = typeof routes;

export default { port: Number(process.env.PORT) || 3000, fetch: app.fetch, idleTimeout: 255 };
