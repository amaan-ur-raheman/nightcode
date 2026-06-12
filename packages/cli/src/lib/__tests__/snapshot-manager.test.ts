import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

describe('SnapshotManager', () => {
    const SNAPSHOTS_FILE = join(
        homedir(),
        '.nightcode',
        'snapshots',
        'snapshots.json',
    );

    beforeEach(async () => {
        try {
            unlinkSync(SNAPSHOTS_FILE);
        } catch {}
        const { snapshotManager } = await import('../snapshot-manager');
        snapshotManager.reset();
    });

    afterEach(() => {
        try {
            unlinkSync(SNAPSHOTS_FILE);
        } catch {}
    });

    it('matches against stored snapshot', async () => {
        const { snapshotManager } = await import('../snapshot-manager');
        // First call stores the snapshot
        const result1 = await snapshotManager.match(
            'test-snapshot',
            'hello world',
        );
        expect(result1.match).toBe(true);

        // Second call with same value should match
        const result2 = await snapshotManager.match(
            'test-snapshot',
            'hello world',
        );
        expect(result2.match).toBe(true);
    });

    it('detects mismatched snapshots', async () => {
        const { snapshotManager } = await import('../snapshot-manager');
        await snapshotManager.match('test-snapshot', 'original value');
        const result = await snapshotManager.match(
            'test-snapshot',
            'changed value',
        );
        expect(result.match).toBe(false);
        expect(result.stored).toBe('original value');
    });

    it('lists stored snapshots', async () => {
        const { snapshotManager } = await import('../snapshot-manager');
        await snapshotManager.match('snap-a', 'value a');
        await snapshotManager.match('snap-b', 'value b');
        const list = await snapshotManager.list();
        expect(list).toHaveLength(2);
        const names = list.map((e) => e.name).sort();
        expect(names).toEqual(['snap-a', 'snap-b']);
    });

    it('deletes a snapshot', async () => {
        const { snapshotManager } = await import('../snapshot-manager');
        await snapshotManager.match('delete-me', 'value');
        const deleted = await snapshotManager.delete('delete-me');
        expect(deleted).toBe(true);
        const list = await snapshotManager.list();
        expect(list).toHaveLength(0);
    });

    it('returns false when deleting nonexistent snapshot', async () => {
        const { snapshotManager } = await import('../snapshot-manager');
        const deleted = await snapshotManager.delete('does-not-exist');
        expect(deleted).toBe(false);
    });

    it('clears all snapshots', async () => {
        const { snapshotManager } = await import('../snapshot-manager');
        await snapshotManager.match('a', '1');
        await snapshotManager.match('b', '2');
        await snapshotManager.clear();
        const list = await snapshotManager.list();
        expect(list).toHaveLength(0);
    });
});
