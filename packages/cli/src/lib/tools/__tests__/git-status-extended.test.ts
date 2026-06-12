import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('gitStatusExtendedTool', () => {
    const mockRunGit = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        mockRunGit.mockReset();
        vi.doMock('../utils', async (importOriginal) => {
            const orig = await importOriginal<typeof import('../utils')>();
            return { ...orig, runGit: mockRunGit };
        });
    });

    it('parses staged, unstaged, and untracked files', async () => {
        mockRunGit
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'M  staged.ts\n M  unstaged.ts\n??  untracked.ts\n',
                stderr: '',
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'main\n',
                stderr: '',
            });
        const { gitStatusExtendedTool } =
            await import('../git-status-extended');
        const result = await gitStatusExtendedTool();
        expect(result.success).toBe(true);
        expect(result.currentBranch).toBe('main');
        expect(result.staged).toContain('staged.ts');
        expect(result.unstaged).toContain('unstaged.ts');
        expect(result.untracked).toContain('untracked.ts');
    });

    it('returns empty arrays for clean working tree', async () => {
        mockRunGit
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'main\n',
                stderr: '',
            });
        const { gitStatusExtendedTool } =
            await import('../git-status-extended');
        const result = await gitStatusExtendedTool();
        expect(result.success).toBe(true);
        expect(result.staged).toEqual([]);
        expect(result.unstaged).toEqual([]);
        expect(result.untracked).toEqual([]);
    });

    it('returns error on failure', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 128,
            stdout: '',
            stderr: 'not a git repo',
        });
        const { gitStatusExtendedTool } =
            await import('../git-status-extended');
        const result = await gitStatusExtendedTool();
        expect(result.success).toBe(false);
    });
});
