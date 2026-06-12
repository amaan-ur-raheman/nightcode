import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    mkdirSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    readdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

describe('UndoManager', () => {
    const TEST_DIR = join(homedir(), '.nightcode', 'undo');
    const TEST_FILE = join(homedir(), '.nightcode', 'test-file.txt');

    beforeEach(async () => {
        mkdirSync(TEST_DIR, { recursive: true });
        try {
            unlinkSync(TEST_FILE);
        } catch {}
        const { undoManager } = await import('../undo-manager');
        undoManager.reset();
    });

    afterEach(() => {
        try {
            unlinkSync(TEST_FILE);
        } catch {}
        // Clean up backup files
        try {
            const files = readdirSync(TEST_DIR);
            for (const f of files) {
                unlinkSync(join(TEST_DIR, f));
            }
        } catch {}
    });

    it('creates backup for existing file', async () => {
        writeFileSync(TEST_FILE, 'original content', 'utf-8');
        const { undoManager } = await import('../undo-manager');
        const id = await undoManager.backup(
            TEST_FILE,
            'editFile',
            'Edit test-file.txt',
        );
        expect(id).toBeTruthy();
        expect(id.startsWith('undo-')).toBe(true);
    });

    it('creates backup for new file', async () => {
        const { undoManager } = await import('../undo-manager');
        const id = await undoManager.backup(
            TEST_FILE,
            'writeFile',
            'Create test-file.txt',
        );
        expect(id).toBeTruthy();
    });

    it('undoLast restores original content', async () => {
        writeFileSync(TEST_FILE, 'original content', 'utf-8');
        const { undoManager } = await import('../undo-manager');
        await undoManager.backup(TEST_FILE, 'editFile', 'Edit');
        writeFileSync(TEST_FILE, 'modified content', 'utf-8');
        const result = await undoManager.undoLast();
        expect(result).not.toBeNull();
        expect(result!.filePath).toBe(TEST_FILE);
        expect(result!.restored).toBe(true);
        expect(readFileSync(TEST_FILE, 'utf-8')).toBe('original content');
    });

    it('returns null when no undo history exists', async () => {
        const { undoManager } = await import('../undo-manager');
        const result = await undoManager.undoLast();
        expect(result).toBeNull();
    });

    it('getHistory returns entries in reverse order', async () => {
        const { undoManager } = await import('../undo-manager');
        writeFileSync(TEST_FILE, 'v1', 'utf-8');
        await undoManager.backup(TEST_FILE, 'edit', 'first');
        writeFileSync(TEST_FILE, 'v2', 'utf-8');
        await undoManager.backup(TEST_FILE, 'edit', 'second');
        const history = undoManager.getHistory();
        expect(history).toHaveLength(2);
        expect(history[0]!.description).toBe('second');
        expect(history[1]!.description).toBe('first');
    });
});
