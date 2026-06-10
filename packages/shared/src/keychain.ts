import { execSync, execFileSync } from 'child_process';

class KeychainManager {
    private serviceName = 'nightcode';
    
    async setKey(account: string, password: string): Promise<boolean> {
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
        try {
            if (process.platform === 'darwin') {
                const result = execFileSync(
                    'security',
                    ['find-generic-password', '-s', this.serviceName, '-a', account, '-w'],
                    { encoding: 'utf-8' }
                ).trim();
                return result || null;
            }
            
            if (process.platform === 'linux') {
                const result = execFileSync(
                    'secret-tool',
                    ['lookup', this.serviceName, account],
                    { encoding: 'utf-8' }
                ).trim();
                return result || null;
            }
            
            return null;
        } catch {
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
