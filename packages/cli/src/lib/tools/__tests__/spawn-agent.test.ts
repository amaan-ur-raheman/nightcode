import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { injectWorkspaceContext } from '../spawn-agent';
import { undoManager } from '@/lib/undo-manager';

const TEST_DIR = join(tmpdir(), `nightcode-test-spawn-${Date.now()}`);

describe('injectWorkspaceContext', () => {
    beforeEach(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        try {
            const { rmSync } = require('fs');
            rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {}
        vi.restoreAllMocks();
    });

    it('injects folder contents and recent files from undo history', async () => {
        // Create a fake project structure
        writeFileSync(join(TEST_DIR, 'index.ts'), 'console.log("hello");', 'utf-8');
        writeFileSync(join(TEST_DIR, 'package.json'), '{}', 'utf-8');

        // Mock undo history
        vi.spyOn(undoManager, 'getHistory').mockReturnValue([
            {
                id: '1',
                filePath: join(TEST_DIR, 'index.ts'),
                backupPath: join(TEST_DIR, 'index.ts.backup'),
                timestamp: Date.now(),
                tool: 'editFile',
                description: 'test edit',
            },
        ]);

        const result = await injectWorkspaceContext('Solve task X', TEST_DIR);
        
        expect(result).toContain('Solve task X');
        expect(result).toContain('Workspace Context');
        expect(result).toContain('Recently Modified Files');
        expect(result).toContain('index.ts');
        expect(result).toContain('Project Structure');
        expect(result).toContain('package.json');
        expect(result).toContain('File Previews');
    });

    it('returns original task if no context is gathered', async () => {
        // Mock empty directory and no undo history
        vi.spyOn(undoManager, 'getHistory').mockReturnValue([]);
        
        const emptyDir = join(TEST_DIR, 'empty');
        mkdirSync(emptyDir);

        // Mock readdirSync to return empty to simulate no files
        const fs = require('fs');
        vi.spyOn(fs, 'readdirSync').mockReturnValue([]);

        const result = await injectWorkspaceContext('Solve task X', emptyDir);
        expect(result).toBe('Solve task X');
    });
});
