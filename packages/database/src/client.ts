import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import fs from 'fs';
import { execSync } from 'child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaClient as PgClient } from '../generated/postgres/client.ts';

dotenv.config({
    path: path.resolve(import.meta.dirname, '../../../.env'),
});

const databaseUrl =
    process.env.DATABASE_URL ||
    `file:${path.resolve(import.meta.dirname, '../../../nightcode.db')}`;

let dbInstance: any;

if (
    databaseUrl.startsWith('postgresql://') ||
    databaseUrl.startsWith('postgres://')
) {
    const { PrismaClient } = await import('../generated/postgres/client.ts');
    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: parseInt(process.env.DB_POOL_MAX || '20', 10),
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
        connectionTimeoutMillis: parseInt(
            process.env.DB_CONNECT_TIMEOUT || '5000',
            10,
        ),
        statement_timeout: parseInt(
            process.env.DB_STATEMENT_TIMEOUT || '30000',
            10,
        ),
        allowExitOnIdle: true,
    });
    const adapter = new PrismaPg(pool);
    dbInstance = new PrismaClient({ adapter });
} else {
    const { PrismaClient } = await import('../generated/sqlite/client.ts');
    const { PrismaBetterSqlite3 } =
        await import('@prisma/adapter-better-sqlite3');

    let sqlitePath = databaseUrl.replace(/^file:/, '');
    if (!path.isAbsolute(sqlitePath)) {
        sqlitePath = path.resolve(import.meta.dirname, '../prisma', sqlitePath);
    }

    const sqliteDir = path.dirname(sqlitePath);
    if (!fs.existsSync(sqliteDir)) {
        fs.mkdirSync(sqliteDir, { recursive: true });
    }

    if (!fs.existsSync(sqlitePath)) {
        try {
            console.log(
                `[Database] Local SQLite database file not found at ${sqlitePath}. Bootstrapping...`,
            );
            const schemaPath = path.resolve(
                import.meta.dirname,
                '../prisma/schema.sqlite.prisma',
            );
            execSync(
                `bunx prisma db push --schema "${schemaPath}" --accept-data-loss`,
                {
                    env: { ...process.env, DATABASE_URL: databaseUrl },
                    stdio: 'inherit',
                },
            );
            console.log(
                `[Database] Local SQLite database bootstrapped successfully.`,
            );
        } catch (error) {
            console.error(
                `[Database] Failed to bootstrap SQLite database:`,
                error,
            );
        }
    }

    const adapter = new PrismaBetterSqlite3({ url: sqlitePath });
    dbInstance = new PrismaClient({ adapter });
}

export const db = dbInstance as PgClient;
