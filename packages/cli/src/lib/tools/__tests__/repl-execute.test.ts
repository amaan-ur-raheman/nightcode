import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@nightcode/shared', () => ({
    toolInputSchemas: {
        replExecute: { parse: (input: any) => input },
    },
}));

vi.mock('../../repl-runner', () => ({
    replRunner: {
        execute: vi.fn(),
    },
}));

import { replRunner } from '../../repl-runner';
import { replExecuteTool } from '../repl-execute';

describe('replExecuteTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes the command to the replRunner and returns the output', async () => {
        vi.mocked(replRunner.execute).mockResolvedValue('python output');

        const result = await replExecuteTool({ command: 'print("hello")' });

        expect(replRunner.execute).toHaveBeenCalledWith('print("hello")');
        expect(result).toEqual({
            output: 'python output',
        });
    });
});
