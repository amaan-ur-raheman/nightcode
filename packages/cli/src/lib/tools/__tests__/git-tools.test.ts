import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be inside the describe so vi.resetModules + vi.doMock work correctly

describe('gitStatusTool and gitDiffTool', () => {
    const mockRunGit = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        mockRunGit.mockReset();
        vi.doMock('../utils', async (importOriginal) => {
            const orig = await importOriginal<typeof import('../utils')>();
            return { ...orig, runGit: mockRunGit, MAX_DIFF: 5000 };
        });
    });

    describe('gitStatusTool', () => {
        it('returns status output on success', async () => {
            mockRunGit.mockResolvedValue({
                exitCode: 0,
                stdout: '## main\nM file.ts\n',
                stderr: '',
            });
            const { gitStatusTool } = await import('../git');
            const result = await gitStatusTool();
            expect(result).toHaveProperty('status');
            expect(result.status).toContain('main');
        });

        it('returns error on failure', async () => {
            mockRunGit.mockResolvedValue({
                exitCode: 128,
                stdout: '',
                stderr: 'not a git repo',
            });
            const { gitStatusTool } = await import('../git');
            const result = await gitStatusTool();
            expect(result).toHaveProperty('error');
            expect(result.error).toContain('not a git repo');
        });
    });

    describe('gitDiffTool', () => {
        it('returns unstaged diff by default', async () => {
            mockRunGit.mockResolvedValue({
                exitCode: 0,
                stdout: 'diff --git a/file.ts\n-old\n+new\n',
                stderr: '',
            });
            const { gitDiffTool } = await import('../git');
            const result = await gitDiffTool({ path: 'file.ts' });
            expect(result).toHaveProperty('diff');
            expect(result.diff).toContain('diff');
        });

        it('returns staged diff when staged=true', async () => {
            mockRunGit.mockResolvedValue({
                exitCode: 0,
                stdout: 'diff --cached\n-old\n+new\n',
                stderr: '',
            });
            const { gitDiffTool } = await import('../git');
            await gitDiffTool({ staged: true });
            expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
                'diff',
                '--cached',
            ]);
        });

        it('returns error on failure', async () => {
            mockRunGit.mockResolvedValue({
                exitCode: 1,
                stdout: '',
                stderr: 'git diff failed',
            });
            const { gitDiffTool } = await import('../git');
            const result = await gitDiffTool({});
            expect(result).toHaveProperty('error');
        });
    });
});
