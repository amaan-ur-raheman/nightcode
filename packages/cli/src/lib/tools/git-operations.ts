import { toolInputSchemas } from '@nightcode/shared';
import { runGit } from './utils';
import { getProjectCwd } from '../workspace-context';

export async function gitOperationsTool(input: unknown) {
    const { action, branch, message, remote, forceWithLease } =
        toolInputSchemas.gitOperations.parse(input);
    const cwd = getProjectCwd();

    try {
        switch (action) {
            case 'merge': {
                if (!branch)
                    return {
                        success: false,
                        output: 'Branch name is required for merge',
                    };
                const result = await runGit(cwd, ['merge', branch]);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git merge failed',
                    };
                }
                return { success: true, output: result.stdout };
            }

            case 'stash': {
                const args = ['stash'];
                if (message) {
                    args.push('push', '-m', message);
                } else {
                    args.push('push');
                }
                const result = await runGit(cwd, args);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git stash failed',
                    };
                }
                return { success: true, output: result.stdout };
            }

            case 'stashPop': {
                const result = await runGit(cwd, ['stash', 'pop']);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git stash pop failed',
                    };
                }
                return { success: true, output: result.stdout };
            }

            case 'stashList': {
                const result = await runGit(cwd, ['stash', 'list']);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git stash list failed',
                    };
                }
                const stashes = result.stdout
                    .split('\n')
                    .filter((s: string) => s.trim().length > 0);
                return {
                    success: true,
                    stashCount: stashes.length,
                    output: result.stdout,
                };
            }

            case 'push': {
                const args = ['push', remote];
                if (forceWithLease) {
                    args.push('--force-with-lease');
                }
                const result = await runGit(cwd, args);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git push failed',
                    };
                }
                return { success: true, output: result.stdout };
            }

            case 'pull': {
                const result = await runGit(cwd, ['pull', remote]);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git pull failed',
                    };
                }
                return { success: true, output: result.stdout };
            }

            case 'fetch': {
                const result = await runGit(cwd, ['fetch', remote]);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git fetch failed',
                    };
                }
                return { success: true, output: result.stdout };
            }

            default:
                return { success: false, output: `Unknown action: ${action}` };
        }
    } catch (err) {
        return { success: false, output: (err as Error).message };
    }
}
