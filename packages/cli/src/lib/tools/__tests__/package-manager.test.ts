import { describe, it, expect, vi, beforeEach } from 'vitest';
import { packageManagerTool } from '../package-manager';
import { runCommand } from '../../command-runner';

vi.mock('@nightcode/shared', () => ({
    toolInputSchemas: {
        packageManager: {
            parse: (input: any) => input,
        },
    },
}));

vi.mock('../../command-runner', () => ({
    runCommand: vi.fn(),
}));

vi.mock('fs', () => ({
    existsSync: vi.fn((path: string) => {
        if (path.endsWith('bun.lock')) return true;
        return false;
    }),
}));

describe('packageManagerTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('detects package manager automatically (bun) and installs', async () => {
        const mockRunCommand = vi.mocked(runCommand);
        mockRunCommand.mockResolvedValue({
            exitCode: 0,
            stdout: 'bun installed successfully',
            stderr: '',
            durationMs: 100,
        });

        const result = await packageManagerTool({
            action: 'install',
            packages: [],
            isDev: false,
            packageManager: 'auto',
        });

        expect(mockRunCommand).toHaveBeenCalledWith(
            'bun',
            ['install'],
            expect.any(String),
        );
        expect(result).toEqual({
            success: true,
            output: 'bun installed successfully',
            packageManager: 'bun',
        });
    });

    it('installs packages as dev dependencies', async () => {
        const mockRunCommand = vi.mocked(runCommand);
        mockRunCommand.mockResolvedValue({
            exitCode: 0,
            stdout: 'packages added',
            stderr: '',
            durationMs: 150,
        });

        const result = await packageManagerTool({
            action: 'add',
            packages: ['lodash', 'express'],
            isDev: true,
            packageManager: 'npm',
        });

        expect(mockRunCommand).toHaveBeenCalledWith(
            'npm',
            ['install', '--save-dev', 'lodash', 'express'],
            expect.any(String),
        );
        expect(result).toEqual({
            success: true,
            output: 'packages added',
            packageManager: 'npm',
            packagesAdded: ['lodash', 'express'],
        });
    });
});
