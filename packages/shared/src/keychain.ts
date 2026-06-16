import { execFile, execFileSync } from 'child_process';

function runCommandAsync(
    cmd: string,
    args: string[],
    input?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const child = execFile(cmd, args, (error, stdout) => {
            resolve({
                stdout: stdout || '',
                stderr: error?.message || '',
                exitCode: error
                    ? typeof error.code === 'number'
                        ? error.code
                        : 1
                    : 0,
            });
        });
        if (input && child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
        }
    });
}

class KeychainManager {
    private serviceName = 'nightcode';
    private notFoundCache = new Set<string>();

    async setKey(account: string, password: string): Promise<boolean> {
        // Clear negative cache so newly-set keys are found on next lookup
        this.notFoundCache.delete(account);

        try {
            if (process.platform === 'darwin') {
                try {
                    await runCommandAsync('security', [
                        'delete-generic-password',
                        '-s',
                        this.serviceName,
                        '-a',
                        account,
                    ]);
                } catch {
                    // Ignore error if key does not exist yet
                }

                const addRes = await runCommandAsync('security', [
                    'add-generic-password',
                    '-s',
                    this.serviceName,
                    '-a',
                    account,
                    '-w',
                    password,
                    '-U',
                ]);
                return addRes.exitCode === 0;
            }

            if (process.platform === 'linux') {
                const res = await runCommandAsync(
                    'secret-tool',
                    [
                        'store',
                        `--label=NightCode ${account}`,
                        this.serviceName,
                        account,
                    ],
                    password,
                );
                return res.exitCode === 0;
            }

            return false;
        } catch {
            return false;
        }
    }

    async getKey(account: string): Promise<string | null> {
        // Cache negative results to avoid repeated keychain CLI calls that
        // produce noisy stderr warnings ("The specified item could not be found")
        if (this.notFoundCache.has(account)) {
            return null;
        }

        try {
            if (process.platform === 'darwin') {
                const res = await runCommandAsync('security', [
                    'find-generic-password',
                    '-s',
                    this.serviceName,
                    '-a',
                    account,
                    '-w',
                ]);
                if (res.exitCode === 0 && res.stdout) {
                    return res.stdout.trim();
                }
                this.notFoundCache.add(account);
                return null;
            }

            if (process.platform === 'linux') {
                const res = await runCommandAsync('secret-tool', [
                    'lookup',
                    this.serviceName,
                    account,
                ]);
                if (res.exitCode === 0 && res.stdout) {
                    return res.stdout.trim();
                }
                this.notFoundCache.add(account);
                return null;
            }

            return null;
        } catch {
            this.notFoundCache.add(account);
            return null;
        }
    }

    async deleteKey(account: string): Promise<boolean> {
        try {
            if (process.platform === 'darwin') {
                const res = await runCommandAsync('security', [
                    'delete-generic-password',
                    '-s',
                    this.serviceName,
                    '-a',
                    account,
                ]);
                return res.exitCode === 0;
            }

            if (process.platform === 'linux') {
                const res = await runCommandAsync('secret-tool', [
                    'clear',
                    this.serviceName,
                    account,
                ]);
                return res.exitCode === 0;
            }

            return false;
        } catch {
            return false;
        }
    }

    async listKeys(): Promise<string[]> {
        return [];
    }

    isAvailable(): boolean {
        try {
            if (process.platform === 'darwin') {
                execFileSync('which', ['security'], { stdio: 'ignore' });
                return true;
            }
            if (process.platform === 'linux') {
                execFileSync('which', ['secret-tool'], { stdio: 'ignore' });
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }
}

export const keychain = new KeychainManager();
