import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { sentry } from '@sentry/hono/bun';
import * as Sentry from "@sentry/hono/bun";

import chat from './routes/chat';
import sessions from './routes/sessions';

const app = new Hono();

app.use(
    sentry(app, {
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: 1.0,
        enableLogs: true,
        sendDefaultPii: true,
    }),
);

app.get("/debug-sentry", () => {
    // Send a log before throwing the error
    Sentry.logger.info('User triggered test error', {
        action: 'test_error_endpoint',
    });
    // Send a test metric before throwing the error
    Sentry.metrics.count('test_counter', 1);
    throw new Error("My first Sentry error!");
});


app.onError((error, c) => {
    if (error instanceof HTTPException) {
        Sentry.logger.warn("Handled HTTP Error", {
            status: error.status,
            message: error.message || "Request Failed",
            path: c.req.path,
            method: c.req.method,
        });

        return c.json({
            error: error.message || "Request failed"
        }, error.status);
    }

    Sentry.logger.error("Unhandled server error", {
        path: c.req.path,
        method: c.req.method,
        error: error instanceof Error ? error.message : "Unknown error",
    });

    return c.json({
        error: "Internal server error"
    }, 500);
});

const routes = app.route("/sessions", sessions).route("/chat", chat);

export type AppType = typeof routes;

export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };
