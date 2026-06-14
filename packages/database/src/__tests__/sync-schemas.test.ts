import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('sync-schemas script integration', () => {
    const prismaDir = path.resolve(import.meta.dirname, '../../prisma');
    const schemaPath = path.resolve(prismaDir, 'schema.prisma');
    const sqliteSchemaPath = path.resolve(prismaDir, 'schema.sqlite.prisma');

    let originalSchemaContent = '';
    let originalSqliteSchemaContent = '';

    beforeEach(() => {
        originalSchemaContent = fs.readFileSync(schemaPath, 'utf8');
        try {
            originalSqliteSchemaContent = fs.readFileSync(sqliteSchemaPath, 'utf8');
        } catch {
            originalSqliteSchemaContent = '';
        }
    });

    afterEach(() => {
        fs.writeFileSync(schemaPath, originalSchemaContent, 'utf8');
        if (originalSqliteSchemaContent) {
            fs.writeFileSync(sqliteSchemaPath, originalSqliteSchemaContent, 'utf8');
        } else {
            try {
                fs.unlinkSync(sqliteSchemaPath);
            } catch {}
        }
    });

    const runSyncScript = () => {
        try {
            const scriptPath = path.resolve(prismaDir, 'sync-schemas.ts');
            const stdout = execSync(`bun run ${scriptPath}`, { stdio: 'pipe' });
            return { success: true, output: stdout.toString() };
        } catch (error: any) {
            return {
                success: false,
                output: (error.stdout?.toString() || '') + '\n' + (error.stderr?.toString() || ''),
            };
        }
    };

    it('successfully syncs a valid schema with double quotes', () => {
        const mockInput = `
generator client {
    provider = "prisma-client"
    output   = "../generated/postgres"
}

datasource db {
    provider = "postgresql"
}
`;
        fs.writeFileSync(schemaPath, mockInput, 'utf8');

        const result = runSyncScript();
        expect(result.success).toBe(true);

        const sqliteContent = fs.readFileSync(sqliteSchemaPath, 'utf8');
        expect(sqliteContent).toContain('output   = "../generated/sqlite"');
        expect(sqliteContent).toContain('provider = "sqlite"');
        expect(sqliteContent).toContain('THIS FILE IS AUTO-GENERATED. DO NOT EDIT DIRECTLY.');
    });

    it('successfully syncs a valid schema with single quotes and custom whitespace', () => {
        const mockInput = `
generator client {
    provider = 'prisma-client'
    output='../generated/postgres'
}

datasource db {
    provider= 'postgresql'
}
`;
        fs.writeFileSync(schemaPath, mockInput, 'utf8');

        const result = runSyncScript();
        expect(result.success).toBe(true);

        const sqliteContent = fs.readFileSync(sqliteSchemaPath, 'utf8');
        expect(sqliteContent).toContain('output   = "../generated/sqlite"');
        expect(sqliteContent).toContain('provider = "sqlite"');
    });

    it('fails when generator output path does not match pattern', () => {
        const mockInput = `
generator client {
    provider = "prisma-client"
    output   = "../generated/mysql"
}

datasource db {
    provider = "postgresql"
}
`;
        fs.writeFileSync(schemaPath, mockInput, 'utf8');

        const result = runSyncScript();
        expect(result.success).toBe(false);
        expect(result.output).toContain('Failed to replace the client generator output path');
    });

    it('fails when datasource provider does not match pattern', () => {
        const mockInput = `
generator client {
    provider = "prisma-client"
    output   = "../generated/postgres"
}

datasource db {
    provider = "mysql"
}
`;
        fs.writeFileSync(schemaPath, mockInput, 'utf8');

        const result = runSyncScript();
        expect(result.success).toBe(false);
        expect(result.output).toContain('Failed to replace the database provider');
    });
});
