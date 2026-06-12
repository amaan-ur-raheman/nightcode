import { toolInputSchemas } from '@nightcode/shared';
import { runGit } from './utils';

export async function gitBranchTool(input: unknown) {
    const { action, name } = toolInputSchemas.gitBranch.parse(input);
    const cwd = process.cwd();

    try {
        switch (action) {
            case 'create': {
                if (!name)
                    return {
                        success: false,
                        output: 'Branch name is required for create',
                    };
                const result = await runGit(cwd, ['branch', name]);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git branch create failed',
                    };
                }
                return { success: true, output: `Created branch: ${name}` };
            }
            case 'list': {
                const result = await runGit(cwd, ['branch', '--list']);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git branch list failed',
                    };
                }
                const branches = result.stdout
                    .split('\n')
                    .map((b: string) => b.replace(/^\*?\s*/, '').trim())
                    .filter((b: string) => b.length > 0);

                const currentResult = await runGit(cwd, [
                    'branch',
                    '--show-current',
                ]);
                const currentBranch = currentResult.stdout.trim();

                return {
                    success: true,
                    branches,
                    currentBranch,
                    output: result.stdout,
                };
            }
            case 'delete': {
                if (!name)
                    return {
                        success: false,
                        output: 'Branch name is required for delete',
                    };
                const result = await runGit(cwd, ['branch', '-d', name]);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git branch delete failed',
                    };
                }
                return { success: true, output: result.stdout };
            }
            case 'checkout': {
                if (!name)
                    return {
                        success: false,
                        output: 'Branch name is required for checkout',
                    };
                const result = await runGit(cwd, ['checkout', name]);
                if (result.exitCode !== 0) {
                    return {
                        success: false,
                        output: result.stderr || 'git checkout failed',
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
