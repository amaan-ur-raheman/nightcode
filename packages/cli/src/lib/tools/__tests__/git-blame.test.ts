import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('gitBlameTool', () => {
    const mockRunGit = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        mockRunGit.mockReset();
        vi.doMock('../utils', async (importOriginal) => {
            const orig = await importOriginal<typeof import('../utils')>();
            return { ...orig, runGit: mockRunGit };
        });
    });

    it('returns blame lines on success', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 0,
            stdout: 'abc12345 (John 2024-01-01 1) const x = 1;\ndef56789 (Jane 2024-01-02 2) const y = 2;\n',
            stderr: '',
        });
        const { gitBlameTool } = await import('../git-blame');
        const result = await gitBlameTool({ filePath: 'file.ts' });
        expect(result.success).toBe(true);
        expect(result.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('passes line range to git blame', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 0,
            stdout: 'abc12345 (John 2024-01-01 5) hello\n',
            stderr: '',
        });
        const { gitBlameTool } = await import('../git-blame');
        await gitBlameTool({ filePath: 'file.ts', startLine: 5, endLine: 10 });
        expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
            'blame',
            '-L',
            '5,10',
            'file.ts',
        ]);
    });

    it('returns error on failure', async () => {
        mockRunGit.mockResolvedValue({
            exitCode: 128,
            stdout: '',
            stderr: 'file not found',
        });
        const { gitBlameTool } = await import('../git-blame');
        const result = await gitBlameTool({ filePath: 'missing.ts' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('file not found');
    });
});
