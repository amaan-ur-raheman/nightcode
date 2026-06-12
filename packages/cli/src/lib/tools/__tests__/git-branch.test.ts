import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('gitBranchTool', () => {
    const mockRunGit = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        mockRunGit.mockReset();
        vi.doMock('../utils', async (importOriginal) => {
            const orig = await importOriginal<typeof import('../utils')>();
            return { ...orig, runGit: mockRunGit };
        });
    });

    it('creates a branch', async () => {
        mockRunGit.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
        const { gitBranchTool } = await import('../git-branch');
        const result = await gitBranchTool({
            action: 'create',
            name: 'feature-x',
        });
        expect(result).toEqual({
            success: true,
            output: 'Created branch: feature-x',
        });
        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
            'branch',
            'feature-x',
        ]);
    });

    it('returns error when create missing name', async () => {
        const { gitBranchTool } = await import('../git-branch');
        const result = await gitBranchTool({ action: 'create' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Branch name is required');
    });

    it('lists branches', async () => {
        mockRunGit
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: '* main\n  feature-a\n  feature-b\n',
                stderr: '',
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'main\n',
                stderr: '',
            });
        const { gitBranchTool } = await import('../git-branch');
        const result = await gitBranchTool({ action: 'list' });
        expect(result.success).toBe(true);
        expect(result.branches).toContain('main');
        expect(result.branches).toContain('feature-a');
        expect(result.currentBranch).toBe('main');
    });

    it('deletes a branch', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 0,
            stdout: 'Deleted branch feature-x\n',
            stderr: '',
        });
        const { gitBranchTool } = await import('../git-branch');
        const result = await gitBranchTool({
            action: 'delete',
            name: 'feature-x',
        });
        expect(result.success).toBe(true);
        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
            'branch',
            '-d',
            'feature-x',
        ]);
    });

    it('returns error when delete missing name', async () => {
        const { gitBranchTool } = await import('../git-branch');
        const result = await gitBranchTool({ action: 'delete' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Branch name is required');
    });

    it('checks out a branch', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 0,
            stdout: 'Switched to branch feature-a\n',
            stderr: '',
        });
        const { gitBranchTool } = await import('../git-branch');
        const result = await gitBranchTool({
            action: 'checkout',
            name: 'feature-a',
        });
        expect(result.success).toBe(true);
        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
            'checkout',
            'feature-a',
        ]);
    });

    it('returns error when checkout missing name', async () => {
        const { gitBranchTool } = await import('../git-branch');
        const result = await gitBranchTool({ action: 'checkout' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Branch name is required');
    });

    it('throws for unknown action (Zod validation)', async () => {
        const { gitBranchTool } = await import('../git-branch');
        expect(() => gitBranchTool({ action: 'unknown' })).rejects.toThrow();
    });
});
