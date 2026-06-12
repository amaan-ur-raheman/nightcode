import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUndoLast = vi.hoisted(() => vi.fn());

vi.mock('../../undo-manager', () => ({
    undoManager: {
        undoLast: mockUndoLast,
    },
}));

import { undoTool } from '../undo';

describe('undoTool', () => {
    beforeEach(() => {
        mockUndoLast.mockReset();
    });

    it('returns "Nothing to undo" when no backups exist', async () => {
        mockUndoLast.mockResolvedValue(null);
        const result = await undoTool({});
        expect(result).toEqual({ output: 'Nothing to undo' });
    });

    it('returns success message when undo succeeds', async () => {
        mockUndoLast.mockResolvedValue({
            filePath: 'test/file.ts',
            restored: true,
        });
        const result = await undoTool({});
        expect(result.output).toContain('test/file.ts');
        expect(result.output).toContain('success');
    });

    it('returns failed message when restore fails', async () => {
        mockUndoLast.mockResolvedValue({
            filePath: 'test/file.ts',
            restored: false,
        });
        const result = await undoTool({});
        expect(result.output).toContain('test/file.ts');
        expect(result.output).toContain('failed');
    });
});
