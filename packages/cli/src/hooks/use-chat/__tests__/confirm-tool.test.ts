import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirmToolIfNeeded } from '../confirm-tool';
import { ConfirmationManager } from '@/lib/tools/dangerous-ops';

vi.mock('fs/promises', () => ({
    readFile: vi.fn(),
}));

vi.mock('@/lib/tools/utils', () => ({
    resolveInsideCwd: (path: string) => ({
        cwd: '/mock/cwd',
        resolved: `/mock/cwd/${path}`,
    }),
}));

vi.mock('@/lib/settings', () => ({
    isConfirmationEnabled: vi.fn(() => true),
    getAutonomyLevel: vi.fn(() => 'strict'),
}));

import { readFile } from 'fs/promises';
import { isConfirmationEnabled } from '@/lib/settings';

describe('confirmToolIfNeeded', () => {
    let confirmationManager: ConfirmationManager;

    beforeEach(() => {
        vi.clearAllMocks();
        confirmationManager = new ConfirmationManager();
        (isConfirmationEnabled as any).mockReturnValue(true);
    });

    it('bypasses confirmation if disabled', async () => {
        (isConfirmationEnabled as any).mockReturnValue(false);
        const result = await confirmToolIfNeeded(
            'editFile',
            { path: 'foo.txt', oldString: 'a', newString: 'b' },
            false,
            confirmationManager,
        );
        expect(result).toEqual({ confirmed: true });
    });

    it('generates a diff and requests confirmation for editFile', async () => {
        (readFile as any).mockResolvedValue('hello world');
        const reqPromise = confirmToolIfNeeded(
            'editFile',
            { path: 'test.txt', oldString: 'world', newString: 'everyone' },
            false,
            confirmationManager,
        );

        // Wait for the request to be queued
        await new Promise((r) => setTimeout(r, 10));

        expect(confirmationManager.pending.size).toBe(1);
        const req = Array.from(confirmationManager.pending.values())[0]!;
        expect(req.toolName).toBe('editFile');
        expect(req.diff).toContain('hello everyone');

        confirmationManager.confirm(req.id);
        const result = await reqPromise;
        expect(result).toEqual({ confirmed: true });
    });

    it('generates a diff for writeFile', async () => {
        (readFile as any).mockResolvedValue('old contents');
        const reqPromise = confirmToolIfNeeded(
            'writeFile',
            { path: 'write.txt', content: 'new contents' },
            false,
            confirmationManager,
        );

        await new Promise((r) => setTimeout(r, 10));

        expect(confirmationManager.pending.size).toBe(1);
        const req = Array.from(confirmationManager.pending.values())[0]!;
        expect(req.diff).toContain('new contents');

        confirmationManager.confirm(req.id);
        await reqPromise;
    });

    it('passes patch directly as diff', async () => {
        const patchContent = 'patch diff data';
        const reqPromise = confirmToolIfNeeded(
            'patch',
            { patch: patchContent },
            false,
            confirmationManager,
        );

        await new Promise((r) => setTimeout(r, 10));

        expect(confirmationManager.pending.size).toBe(1);
        const req = Array.from(confirmationManager.pending.values())[0]!;
        expect(req.diff).toBe(patchContent);

        confirmationManager.confirm(req.id);
        await reqPromise;
    });
});
