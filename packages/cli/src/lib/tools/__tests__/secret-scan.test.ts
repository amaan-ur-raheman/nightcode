import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';

const tmpDir = join(import.meta.dirname, '__tmp_secretscan');

describe('secretScanTool', () => {
    let secretScanTool: typeof import('../secret-scan').secretScanTool;

    beforeEach(async () => {
        await mkdir(tmpDir, { recursive: true });
        vi.resetModules();
        ({ secretScanTool } = await import('../secret-scan'));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('returns no secrets for clean file', async () => {
        await writeFile(join(tmpDir, 'clean.ts'), 'const x = 1;\n');
        const result = await secretScanTool({
            path: join(tmpDir, 'clean.ts'),
            recursive: false,
        });
        expect(result.secrets).toEqual([]);
        expect(result.count).toBe(0);
        expect(result.message).toBe('No secrets found.');
    });

    it('detects API keys', async () => {
        await writeFile(
            join(tmpDir, 'config.ts'),
            "const apiKey = 'sk-1234567890abcdef';\n",
        );
        const result = await secretScanTool({
            path: join(tmpDir, 'config.ts'),
            recursive: false,
        });
        expect(result.count).toBeGreaterThanOrEqual(1);
        expect(
            result.secrets.some((s: { type: string }) => s.type === 'API Key'),
        ).toBe(true);
    });

    it('detects database URLs', async () => {
        await writeFile(
            join(tmpDir, 'db.ts'),
            "const url = 'postgres://user:pass@localhost/db';\n",
        );
        const result = await secretScanTool({
            path: join(tmpDir, 'db.ts'),
            recursive: false,
        });
        expect(result.count).toBeGreaterThanOrEqual(1);
        expect(
            result.secrets.some(
                (s: { type: string }) => s.type === 'Database URL',
            ),
        ).toBe(true);
    });

    it('detects private keys', async () => {
        await writeFile(
            join(tmpDir, 'key.pem'),
            '-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n-----END RSA PRIVATE KEY-----\n',
        );
        const result = await secretScanTool({
            path: join(tmpDir, 'key.pem'),
            recursive: false,
        });
        expect(result.count).toBeGreaterThanOrEqual(1);
        expect(
            result.secrets.some(
                (s: { type: string }) => s.type === 'Private Key',
            ),
        ).toBe(true);
    });

    it('groups results by severity', async () => {
        await writeFile(
            join(tmpDir, 'mixed.ts'),
            [
                "const apiKey = 'sk-1234567890abcdef';",
                "const url = 'postgres://user:pass@localhost/db';",
                "const key = 'some-long-value-here-1234567890123456';",
            ].join('\n'),
        );
        const result = await secretScanTool({
            path: join(tmpDir, 'mixed.ts'),
            recursive: false,
        });
        expect(result.count).toBeGreaterThanOrEqual(2);
        expect(result).toHaveProperty('summary');
        expect(typeof result.summary).toBe('string');
    });

    it('skips unreadable files gracefully', async () => {
        const result = await secretScanTool({
            path: join(tmpDir, 'nonexistent.txt'),
            recursive: false,
        });
        expect(result.secrets).toEqual([]);
        expect(result.count).toBe(0);
    });

    it('scans recursively when recursive=true', async () => {
        const subdir = join(tmpDir, 'sub');
        await mkdir(subdir, { recursive: true });
        await writeFile(
            join(subdir, 'secret.ts'),
            "const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';\n",
        );
        const result = await secretScanTool({ path: tmpDir, recursive: true });
        expect(result.count).toBeGreaterThanOrEqual(1);
    });
});
