import { toolInputSchemas } from '@nightcode/shared';
import { MAX_DIFF, runGit } from './utils';
import { getProjectCwd } from '../workspace-context';

export async function gitStatusTool() {
    const result = await runGit(getProjectCwd(), [
        'status',
        '--short',
        '--branch',
    ]);
    if (result.exitCode !== 0)
        return { error: result.stderr || 'git status failed' };
    return { status: result.stdout };
}

export async function gitDiffTool(input: unknown) {
    const { path, staged } = toolInputSchemas.gitDiff.parse(input);
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (path) args.push('--', path);
    const result = await runGit(getProjectCwd(), args);
    if (result.exitCode !== 0)
        return { error: result.stderr || 'git diff failed' };
    const diff = result.stdout;
    return {
        diff:
            diff.length > MAX_DIFF
                ? diff.slice(0, MAX_DIFF) +
                  `\n...(truncated, ${diff.length} total chars)`
                : diff,
        truncated: diff.length > MAX_DIFF,
    };
}
