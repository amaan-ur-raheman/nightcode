import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunGit } = vi.hoisted(() => {
    return { mockRunGit: vi.fn() };
});

vi.mock('../tools/utils', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../tools/utils')>();
    return {
        ...orig,
        runGit: mockRunGit,
    };
});

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import { setupWorktree, teardownWorktree } from '../worktree';

describe('worktree-manager', () => {
    beforeEach(() => {
        mockRunGit.mockReset();
    });

    describe('setupWorktree', () => {
        it('returns parent CWD if not a git repository', async () => {
            // isGitRepository check returns non-zero
            mockRunGit.mockResolvedValueOnce({
                exitCode: 1,
                stdout: '',
                stderr: 'fatal: not a git repository',
            });

            const path = await setupWorktree('agent-1', '/parent/cwd');
            expect(path).toBe('/parent/cwd');
            expect(mockRunGit).toHaveBeenCalledWith('/parent/cwd', [
                'rev-parse',
                '--is-inside-work-tree',
            ]);
        });

        it('creates git worktree and applies changes if dirty', async () => {
            // 1. isGitRepository -> true
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'true',
                stderr: '',
            });
            // 2. git worktree add -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });
            // 3. git diff HEAD -> dirty changes
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'diff --git a/file.ts b/file.ts...',
                stderr: '',
            });
            // 4. git apply -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });

            const path = await setupWorktree('agent-1', '/parent/cwd');
            expect(path).toContain('/.nightcode/worktrees/worktree-agent_1');

            // Verify the git commands executed
            expect(mockRunGit).toHaveBeenCalledWith('/parent/cwd', [
                'rev-parse',
                '--is-inside-work-tree',
            ]);
            expect(mockRunGit).toHaveBeenCalledWith('/parent/cwd', [
                'worktree',
                'add',
                '-b',
                'nightcode/worktree-agent_1',
                expect.stringContaining('worktree-agent_1'),
                'HEAD',
            ]);
            expect(mockRunGit).toHaveBeenCalledWith('/parent/cwd', [
                'diff',
                'HEAD',
            ]);
        });
    });

    describe('teardownWorktree', () => {
        it('does nothing if worktreePath is equal to parentCwd', async () => {
            await teardownWorktree(
                'agent-1',
                '/parent/cwd',
                '/parent/cwd',
                true,
            );
            expect(mockRunGit).not.toHaveBeenCalled();
        });

        it('merges changes and cleans up worktree on success', async () => {
            const worktreePath = '/worktree/agent-1';
            const parentCwd = '/parent/cwd';

            // 1. git status -> changes exist
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'M file.ts',
                stderr: '',
            });
            // 2. git add -A -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });
            // 3. git commit -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });
            // 4. git merge -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });
            // 5. git worktree remove -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });
            // 6. git branch -D -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });

            await teardownWorktree('agent-1', worktreePath, parentCwd, true);

            expect(mockRunGit).toHaveBeenCalledWith(worktreePath, [
                'status',
                '--porcelain',
            ]);
            expect(mockRunGit).toHaveBeenCalledWith(worktreePath, [
                'add',
                '-A',
            ]);
            expect(mockRunGit).toHaveBeenCalledWith(
                worktreePath,
                ['commit', '-m', 'Auto-commit changes from subagent agent-1'],
                {
                    GIT_AUTHOR_NAME: 'NightCode Agent',
                    GIT_AUTHOR_EMAIL: 'agent@nightcode.ai',
                    GIT_COMMITTER_NAME: 'NightCode Agent',
                    GIT_COMMITTER_EMAIL: 'agent@nightcode.ai',
                },
            );
            expect(mockRunGit).toHaveBeenCalledWith(parentCwd, [
                'merge',
                'nightcode/worktree-agent_1',
                '--no-edit',
            ]);
            expect(mockRunGit).toHaveBeenCalledWith(parentCwd, [
                'worktree',
                'remove',
                '--force',
                worktreePath,
            ]);
            expect(mockRunGit).toHaveBeenCalledWith(parentCwd, [
                'branch',
                '-D',
                'nightcode/worktree-agent_1',
            ]);
        });

        it('discards changes and cleans up worktree on failure without merging', async () => {
            const worktreePath = '/worktree/agent-1';
            const parentCwd = '/parent/cwd';

            // 1. git worktree remove -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });
            // 2. git branch -D -> success
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });

            await teardownWorktree('agent-1', worktreePath, parentCwd, false);

            expect(mockRunGit).not.toHaveBeenCalledWith(
                worktreePath,
                expect.anything(),
            );
            expect(mockRunGit).not.toHaveBeenCalledWith(
                parentCwd,
                expect.arrayContaining(['merge']),
            );
            expect(mockRunGit).toHaveBeenCalledWith(parentCwd, [
                'worktree',
                'remove',
                '--force',
                worktreePath,
            ]);
            expect(mockRunGit).toHaveBeenCalledWith(parentCwd, [
                'branch',
                '-D',
                'nightcode/worktree-agent_1',
            ]);
        });
    });
});
