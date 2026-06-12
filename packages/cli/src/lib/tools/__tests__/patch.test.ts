import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('patchTool', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('rejects patches exceeding MAX_PATCH_SIZE', async () => {
        vi.doMock('../undo-manager', () => ({
            undoManager: { backup: vi.fn() },
        }));
        const { patchTool } = await import('../patch');
        const hugePatch = 'x'.repeat(200_001);
        const result = await patchTool({ patch: hugePatch });
        expect(result).toHaveProperty('error');
        expect((result as { error: string }).error).toContain(
            'exceeds maximum size',
        );
    });

    it('rejects patches that escape project directory', async () => {
        vi.doMock('../undo-manager', () => ({
            undoManager: { backup: vi.fn() },
        }));
        const { patchTool } = await import('../patch');
        const maliciousPatch =
            '--- a/../../etc/passwd\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-old\n+new\n';
        const result = await patchTool({ patch: maliciousPatch });
        expect(result).toHaveProperty('error');
        expect((result as { error: string }).error).toContain(
            'escapes project directory',
        );
    });
});
