import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'nightcode-test-env');

describe('envManageTool', () => {
    beforeEach(() => {
        vi.resetModules();
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(
            join(TEST_DIR, '.env'),
            'DATABASE_URL=postgres://localhost/db\nAPI_KEY=secret123\n',
        );
        vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('reads env file content', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({ action: 'read', file: '.env' });
        expect(result).toHaveProperty('content');
        expect(result.content).toContain('DATABASE_URL');
        expect(result).toHaveProperty('lines');
    });

    it('lists variables with key/value/line', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({ action: 'list', file: '.env' });
        expect(result).toHaveProperty('count', 2);
        const variables = (
            result as {
                variables: { key: string; value: string; line: number }[];
            }
        ).variables;
        expect(variables[0]).toHaveProperty('key', 'DATABASE_URL');
        expect(variables[0]).toHaveProperty('value', 'postgres://localhost/db');
    });

    it('adds a new variable', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({
            action: 'add',
            key: 'NEW_VAR',
            value: 'hello',
            file: '.env',
        });
        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('key', 'NEW_VAR');
        const { readFileSync } = await import('fs');
        const content = readFileSync(join(TEST_DIR, '.env'), 'utf-8');
        expect(content).toContain('NEW_VAR=hello');
    });

    it('rejects adding duplicate variable', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({
            action: 'add',
            key: 'API_KEY',
            value: 'new',
            file: '.env',
        });
        expect(result).toHaveProperty('error');
        expect(result.error).toContain('already exists');
    });

    it('updates an existing variable', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({
            action: 'update',
            key: 'API_KEY',
            value: 'updated',
            file: '.env',
        });
        expect(result).toHaveProperty('success', true);
        const { readFileSync } = await import('fs');
        const content = readFileSync(join(TEST_DIR, '.env'), 'utf-8');
        expect(content).toContain('API_KEY=updated');
        expect(content).not.toContain('API_KEY=secret123');
    });

    it('rejects updating nonexistent variable', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({
            action: 'update',
            key: 'MISSING',
            value: 'x',
            file: '.env',
        });
        expect(result).toHaveProperty('error');
        expect(result.error).toContain('not found');
    });

    it('deletes a variable', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({
            action: 'delete',
            key: 'API_KEY',
            file: '.env',
        });
        expect(result).toHaveProperty('success', true);
        const { readFileSync } = await import('fs');
        const content = readFileSync(join(TEST_DIR, '.env'), 'utf-8');
        expect(content).not.toContain('API_KEY');
        expect(content).toContain('DATABASE_URL');
    });

    it('rejects deleting nonexistent variable', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({
            action: 'delete',
            key: 'MISSING',
            file: '.env',
        });
        expect(result).toHaveProperty('error');
        expect(result.error).toContain('not found');
    });

    it('returns error for missing file on read', async () => {
        const { envManageTool } = await import('../env-manage');
        const result = await envManageTool({
            action: 'read',
            file: 'nonexistent.env',
        });
        expect(result).toHaveProperty('error');
        expect(result.error).toContain('File not found');
    });

    it('requires key for add/update/delete', async () => {
        const { envManageTool } = await import('../env-manage');
        const r1 = await envManageTool({ action: 'add', value: 'x' });
        expect(r1).toHaveProperty('error');
        const r2 = await envManageTool({ action: 'update', value: 'x' });
        expect(r2).toHaveProperty('error');
        const r3 = await envManageTool({ action: 'delete' });
        expect(r3).toHaveProperty('error');
    });
});
