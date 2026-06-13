import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { timelineManager } from '../timeline-manager';

describe('TimelineManager', () => {
    const TIMELINE_FILE = join(
        homedir(),
        '.nightcode',
        'timelines',
        'test-session.json',
    );

    beforeEach(() => {
        try {
            unlinkSync(TIMELINE_FILE);
        } catch {}
    });

    afterEach(() => {
        try {
            unlinkSync(TIMELINE_FILE);
        } catch {}
    });

    it('loads empty timeline for new sessions', async () => {
        const timeline = await timelineManager.loadTimeline('test-session');
        expect(timeline.sessionId).toBe('test-session');
        expect(timeline.snapshots).toEqual({});
    });

    it('saves and loads timeline data successfully', async () => {
        const data = {
            sessionId: 'test-session',
            snapshots: {
                'msg-1': {
                    commitHash: 'commit-12345',
                    messageId: 'msg-1',
                    timestamp: new Date().toISOString(),
                },
            },
        };

        await timelineManager.saveTimeline('test-session', data);
        const loaded = await timelineManager.loadTimeline('test-session');
        expect(loaded.sessionId).toBe('test-session');
        expect(loaded.snapshots['msg-1']?.commitHash).toBe('commit-12345');
    });

    it('integrates takeSnapshot metadata resolving correctly', async () => {
        const mockSpawn = vi.fn().mockImplementation((args: any) => {
            const cmd = args[0];
            let stdoutVal = '';
            if (cmd === 'git') {
                const sub = args[1];
                if (sub === 'rev-parse') {
                    stdoutVal = 'current-head-sha';
                } else if (sub === 'write-tree') {
                    stdoutVal = 'tree-sha-value';
                } else if (sub === 'commit-tree') {
                    stdoutVal = 'generated-commit-sha';
                }
            }
            return {
                stdout: stdoutVal,
                stderr: '',
                exited: Promise.resolve(0),
            } as any;
        });

        vi.stubGlobal('Bun', { spawn: mockSpawn });

        const commitSha = await timelineManager.takeSnapshot(
            'test-session',
            'msg-2',
            'msg-1',
        );
        expect(commitSha).toBe('generated-commit-sha');

        const loaded = await timelineManager.loadTimeline('test-session');
        expect(loaded.snapshots['msg-2']).toBeDefined();
        expect(loaded.snapshots['msg-2']?.commitHash).toBe(
            'generated-commit-sha',
        );
        expect(loaded.snapshots['msg-2']?.parentMessageId).toBe('msg-1');

        vi.unstubAllGlobals();
    });
});
