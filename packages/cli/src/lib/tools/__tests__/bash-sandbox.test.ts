import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wrapCommandWithDocker } from '../bash';
import { loadSettings } from '../../settings';

vi.mock('../../settings', () => ({
    loadSettings: vi.fn(),
}));

describe('bash sandboxing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generates correct docker arguments for wrapping commands', () => {
        (loadSettings as any).mockReturnValue({
            sandbox: {
                enabled: true,
                image: 'test-node-image:latest',
            },
        });

        const command = 'echo "hello"';
        const cwd = '/my/cwd';
        const env = { FOO: 'bar', PATH: '/usr/bin' };

        const args = wrapCommandWithDocker(command, cwd, env);
        expect(args).toEqual([
            'run',
            '--rm',
            '-i',
            '-v',
            '/my/cwd:/workspace',
            '-w',
            '/workspace',
            '-e',
            'FOO=bar',
            'test-node-image:latest',
            'sh',
            '-c',
            'echo "hello"',
        ]);
    });
});
