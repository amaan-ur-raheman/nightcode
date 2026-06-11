import { execSync, execFileSync } from 'child_process';

class KeychainManager {
    private serviceName = 'nightcode';
    private notFoundCache = new Set<string>();
    
    async setKey(account: string, password: string): Promise<boolean> {
        // Clear negative cache so newly-set keys are found on next lookup
        this.notFoundCache.delete(account);

        try {
            if (process.platform === 'darwin') {
                try {
                    execFileSync(
                        'security',
                        ['delete-generic-password', '-s', this.serviceName, '-a', account],
                        { stdio: 'ignore' }
                    );
                } catch {}
                
                execFileSync(
                    'security',
                    ['add-generic-password', '-s', this.serviceName, '-a', account, '-w', password, '-U'],
                    { stdio: 'ignore' }
                );
                return true;
            }
            
            if (process.platform === 'linux') {
                execFileSync(
                    'sh',
                    ['-c', `secret-tool store --label="NightCode ${account}" "${this.serviceName}" "${account}"`],
                    { input: password, stdio: ['pipe', 'ignore', 'ignore'] }
                );
                return true;
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
                const result = execFileSync(
                    'security',
                    ['find-generic-password', '-s', this.serviceName, '-a', account, '-w'],
                    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
                ).trim();
                if (result) return result;
                this.notFoundCache.add(account);
                return null;
            }
            
            if (process.platform === 'linux') {
                const result = execFileSync(
                    'secret-tool',
                    ['lookup', this.serviceName, account],
                    { encoding: 'utf-8' }
                ).trim();
                if (result) return result;
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
                execFileSync(
                    'security',
                    ['delete-generic-password', '-s', this.serviceName, '-a', account],
                    { stdio: 'ignore' }
                );
                return true;
            }
            
            if (process.platform === 'linux') {
                execFileSync(
                    'secret-tool',
                    ['clear', this.serviceName, account],
                    { stdio: 'ignore' }
                );
                return true;
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
