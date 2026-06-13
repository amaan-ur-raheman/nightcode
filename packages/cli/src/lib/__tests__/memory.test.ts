import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memory } from '../memory';
import * as fsPromises from 'fs/promises';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('[]'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
}));

describe('MemoryManager with file locking', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        // Reset local memory state
        (memory as any).entries.clear();
        (memory as any).loaded = false;
        if ((memory as any).saveTimeout) {
            clearTimeout((memory as any).saveTimeout);
            (memory as any).saveTimeout = null;
        }
        (memory as any)._dirty = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('successfully sets and deletes values while acquiring and releasing a file lock', async () => {
        const mockHandle = {
            close: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(fsPromises.open).mockResolvedValue(mockHandle as any);

        await memory.set('test-key', 'test-val', ['tag1']);

        // Verify lock file was opened and then unlinked
        expect(fsPromises.open).toHaveBeenCalledWith(
            expect.stringContaining('global.json.lock'),
            'wx',
        );
        expect(mockHandle.close).toHaveBeenCalled();
        expect(fsPromises.writeFile).toHaveBeenCalled();
        expect(fsPromises.unlink).toHaveBeenCalledWith(
            expect.stringContaining('global.json.lock'),
        );

        expect(await memory.get('test-key')).toBe('test-val');

        // Clear mock calls to verify delete works similarly
        vi.mocked(fsPromises.open).mockClear();
        vi.mocked(fsPromises.unlink).mockClear();

        await memory.delete('test-key');
        expect(fsPromises.open).toHaveBeenCalled();
        expect(fsPromises.unlink).toHaveBeenCalled();
        expect(await memory.get('test-key')).toBeNull();
    });

    it('throws an error when file lock cannot be acquired after retries', async () => {
        const lockError = new Error('File already exists');
        (lockError as any).code = 'EEXIST';
        vi.mocked(fsPromises.open).mockRejectedValue(lockError);

        // Run with shorter delay for testing speed
        const setPromise = (memory as any).set('test-key', 'test-val');
        await expect(setPromise).rejects.toThrow(
            /Failed to acquire lock on memory file/,
        );

        // Ensure unlink was not called because we never acquired the lock
        expect(fsPromises.unlink).not.toHaveBeenCalled();
    });
});
