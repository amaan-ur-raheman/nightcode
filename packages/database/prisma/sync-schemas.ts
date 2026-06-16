import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(import.meta.dirname, 'schema.prisma');
const sqliteSchemaPath = path.resolve(
    import.meta.dirname,
    'schema.sqlite.prisma',
);

console.log('[Database] Syncing SQLite schema from Postgres schema...');

try {
    let schema = fs.readFileSync(schemaPath, 'utf8');

    // Replace the client generator output path
    const schemaWithSqliteOutput = schema.replace(
        /output\s*=\s*['"]\.\.\/generated\/postgres['"]/,
        'output   = "../generated/sqlite"',
    );
    if (schemaWithSqliteOutput === schema) {
        throw new Error(
            'Failed to replace the client generator output path: pattern "output = ../generated/postgres" not found or has unexpected formatting.',
        );
    }
    schema = schemaWithSqliteOutput;

    // Replace the database provider
    const schemaWithSqliteProvider = schema.replace(
        /provider\s*=\s*['"]postgresql['"]/,
        'provider = "sqlite"',
    );
    if (schemaWithSqliteProvider === schema) {
        throw new Error(
            'Failed to replace the database provider: pattern "provider = postgresql" not found or has unexpected formatting.',
        );
    }
    schema = schemaWithSqliteProvider;

    // Add auto-generation header comment
    const header = `// ----------------------------------------------------
// THIS FILE IS AUTO-GENERATED. DO NOT EDIT DIRECTLY.
// Edit packages/database/prisma/schema.prisma instead.
// ----------------------------------------------------\n\n`;

    fs.writeFileSync(sqliteSchemaPath, header + schema, 'utf8');
    console.log(
        '[Database] SQLite schema generated and synchronized successfully.',
    );
} catch (error) {
    console.error('[Database] Failed to sync schemas:', error);
    process.exit(1);
}
