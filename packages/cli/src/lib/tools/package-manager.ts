import { toolInputSchemas } from '@nightcode/shared';
import { runCommand } from '../command-runner';
import { getProjectCwd } from '../workspace-context';
import { existsSync } from 'fs';
import { join } from 'path';

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

function detectPackageManager(cwd: string): PackageManager {
    if (
        existsSync(join(cwd, 'bun.lockb')) ||
        existsSync(join(cwd, 'bun.lock'))
    ) {
        return 'bun';
    }
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (existsSync(join(cwd, 'yarn.lock'))) {
        return 'yarn';
    }
    return 'npm';
}

async function runPackageManager(
    cwd: string,
    pm: PackageManager,
    args: string[],
): Promise<{ success: boolean; output: string }> {
    const result = await runCommand(pm, args, cwd);
    if (result.exitCode !== 0) {
        return {
            success: false,
            output: result.stderr || result.stdout || `${pm} command failed`,
        };
    }
    return { success: true, output: result.stdout };
}

export async function packageManagerTool(input: unknown) {
    const {
        action,
        packages,
        isDev,
        packageManager: pmInput,
    } = toolInputSchemas.packageManager.parse(input);
    const cwd = getProjectCwd();

    // Detect or use specified package manager
    const pm = pmInput === 'auto' ? detectPackageManager(cwd) : pmInput;

    try {
        switch (action) {
            case 'install': {
                const result = await runPackageManager(cwd, pm, ['install']);
                return {
                    success: result.success,
                    output: result.output,
                    packageManager: pm,
                };
            }

            case 'add': {
                if (!packages || packages.length === 0) {
                    return {
                        success: false,
                        output: 'Package names are required for add',
                    };
                }

                const sub = pm === 'npm' ? 'install' : 'add';
                const args = [sub];
                if (isDev) {
                    args.push('--save-dev');
                }
                args.push(...packages);

                const result = await runPackageManager(cwd, pm, args);
                return {
                    success: result.success,
                    output: result.output,
                    packageManager: pm,
                    packagesAdded: packages,
                };
            }

            case 'remove': {
                if (!packages || packages.length === 0) {
                    return {
                        success: false,
                        output: 'Package names are required for remove',
                    };
                }

                const sub = pm === 'npm' ? 'uninstall' : 'remove';
                const args = [sub, ...packages];
                const result = await runPackageManager(cwd, pm, args);
                return {
                    success: result.success,
                    output: result.output,
                    packageManager: pm,
                    packagesRemoved: packages,
                };
            }

            case 'update': {
                const args =
                    packages && packages.length > 0
                        ? ['update', ...packages]
                        : ['update'];

                const result = await runPackageManager(cwd, pm, args);
                return {
                    success: result.success,
                    output: result.output,
                    packageManager: pm,
                };
            }

            case 'list': {
                const result = await runPackageManager(cwd, pm, [
                    'list',
                    '--depth=0',
                ]);
                return {
                    success: result.success,
                    output: result.output,
                    packageManager: pm,
                };
            }

            case 'outdated': {
                const result = await runPackageManager(cwd, pm, ['outdated']);
                return {
                    success: result.success,
                    output: result.output,
                    packageManager: pm,
                };
            }

            default:
                return { success: false, output: `Unknown action: ${action}` };
        }
    } catch (err) {
        return { success: false, output: (err as Error).message };
    }
}
