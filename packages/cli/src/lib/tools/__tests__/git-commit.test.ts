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
        // getGitState: branch --show-current, status --porcelain, log -1
        mockRunGit
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'main\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'initial commit\n', stderr: '' })
            // preCommitSecretScan: diff --cached --name-only (empty)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            // git commit
            .mockResolvedValueOnce({
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
        // getGitState: branch, status, log
        mockRunGit
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'feature\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'some commit\n', stderr: '' })
            // git add
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            // preCommitSecretScan: diff --cached --name-only (empty, files scanned directly)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            // git commit
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: '[feature def5678] msg\n',
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
        mockRunGit
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'main\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'some commit\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({
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
        mockRunGit
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'main\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'some commit\n', stderr: '' })
            .mockResolvedValueOnce({
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

    it('handles non-existent staged files gracefully during secret scan', async () => {
        mockRunGit
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'main\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'some commit\n', stderr: '' })
            // git add
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            // preCommitSecretScan: diff --cached returns the file
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'file.ts\n', stderr: '' });

        const { gitCommitTool } = await import('../git-commit');
        const result = await gitCommitTool({
            message: 'msg',
            files: ['file.ts'],
        });
        // Scan finds no secrets (file doesn't exist on disk), no crash
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
    });
});
