import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { compress } from 'hono/compress';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

import auth from './routes/auth';
import chat from './routes/chat';
import sessions from './routes/sessions';
import billing from './routes/billing';
import subagent from './routes/subagent';
import orchestrator from './routes/orchestrator';
import exportRoutes from './routes/export';
import models from './routes/models';
import apiKeys from './routes/api-keys';
import { requireAuth } from './middleware/require-auth';
import { serverDebug } from './lib/debug';

const app = new Hono();

app.use(compress());

app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const path = c.req.path;
    const status = c.res.status;
    serverDebug.log('http', `${c.req.method} ${path} ${status} ${duration}ms`);
    if (duration > 1000 || status >= 500) {
        console.log(`${c.req.method} ${path} ${status} ${duration}ms`);
    }
});

app.onError((error, c) => {
    console.error('Unhandled server error:', error);
    if (error instanceof HTTPException) {
        return c.json(
            { error: error.message || 'Request failed' },
            error.status,
        );
    }
    return c.json({ error: 'Internal server error' }, 500);
});

app.use('/chat/*', requireAuth);
app.use('/sessions/*', requireAuth);
app.use('/billing/checkout', requireAuth);
app.use('/billing/portal', requireAuth);
app.use('/billing/credits', requireAuth);
app.use('/subagent/*', requireAuth);
app.use('/orchestrator/*', requireAuth);
app.use('/export/*', requireAuth);
app.use('/api-keys/*', requireAuth);

const routes = app
    .route('/auth', auth)
    .route('/billing', billing)
    .route('/sessions', sessions)
    .route('/chat', chat)
    .route('/subagent', subagent)
    .route('/orchestrator', orchestrator)
    .route('/export', exportRoutes)
    .route('/models', models)
    .route('/api-keys', apiKeys);

export type AppType = typeof routes;

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

export default { port, fetch: app.fetch, idleTimeout: 255 };
