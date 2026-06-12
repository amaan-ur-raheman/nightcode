import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('gitLogTool', () => {
    const mockRunGit = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        mockRunGit.mockReset();
        vi.doMock('../utils', async (importOriginal) => {
            const orig = await importOriginal<typeof import('../utils')>();
            return { ...orig, runGit: mockRunGit };
        });
    });

    it('returns commits with oneline format', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 0,
            stdout: 'abc1234 feat: add feature\ndef5678 fix: bug fix\n',
            stderr: '',
        });
        const { gitLogTool } = await import('../git-log');
        const result = await gitLogTool({ oneline: true, limit: 10 });
        expect(result.success).toBe(true);
        expect(result.commits).toHaveLength(2);
        expect(result.commits[0].hash).toBe('abc1234');
    });

    it('returns empty commits when log is empty', async () => {
        mockRunGit.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
        const { gitLogTool } = await import('../git-log');
        const result = await gitLogTool({ limit: 10 });
        expect(result.success).toBe(true);
        expect(result.commits).toEqual([]);
    });

    it('returns error on failure', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 128,
            stdout: '',
            stderr: 'not a git repo',
        });
        const { gitLogTool } = await import('../git-log');
        const result = await gitLogTool({ limit: 10 });
        expect(result.success).toBe(false);
    });

    it('passes author filter', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 0,
            stdout: 'abc1234 feat: by me\n',
            stderr: '',
        });
        const { gitLogTool } = await import('../git-log');
        await gitLogTool({ author: 'testuser', limit: 5, oneline: true });
        expect(mockRunGit).toHaveBeenCalledWith(
            process.cwd(),
            expect.arrayContaining(['--author=testuser']),
        );
    });
});
