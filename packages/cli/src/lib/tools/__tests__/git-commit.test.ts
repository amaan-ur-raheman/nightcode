import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('gitCommitTool', () => {
    const mockRunGit = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        mockRunGit.mockReset();
        vi.doMock('../utils', async (importOriginal) => {
            const orig = await importOriginal<typeof import('../utils')>();
            return { ...orig, runGit: mockRunGit };
        });
    });

    it('commits with message', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 0,
            stdout: '[main abc1234] feat: add feature\n',
            stderr: '',
        });
        const { gitCommitTool } = await import('../git-commit');
        const result = await gitCommitTool({ message: 'feat: add feature' });
        expect(result.success).toBe(true);
        expect(result.commitHash).toBe('abc1234');
    });

    it('stages files before commit when files provided', async () => {
        mockRunGit
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: '[main def5678] msg\n',
                stderr: '',
            });
        const { gitCommitTool } = await import('../git-commit');
        const result = await gitCommitTool({
            message: 'msg',
            files: ['file.ts'],
        });
        expect(result.success).toBe(true);
        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
            'add',
            'file.ts',
        ]);
    });

    it('returns error on commit failure', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'nothing to commit',
        });
        const { gitCommitTool } = await import('../git-commit');
        const result = await gitCommitTool({ message: 'msg' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('nothing to commit');
    });

    it('returns error on add failure', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'pathspec not matched',
        });
        const { gitCommitTool } = await import('../git-commit');
        const result = await gitCommitTool({
            message: 'msg',
            files: ['missing.ts'],
        });
        expect(result.success).toBe(false);
        expect(result.output).toContain('pathspec not matched');
    });
});
