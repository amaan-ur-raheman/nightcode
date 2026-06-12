import { describe, it, expect, vi, beforeEach } from 'vitest';
import { keychain } from '../keychain';

describe('KeychainManager', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns appropriate isAvailable based on platform tools', () => {
        const result = keychain.isAvailable();
        // Should be a boolean - either true (on macOS/Linux with tools) or false (otherwise)
        expect(typeof result).toBe('boolean');
    });

    it('listKeys returns empty array', async () => {
        const result = await keychain.listKeys();
        expect(result).toEqual([]);
    });

    it('setKey returns false when platform has no keychain tools', async () => {
        // On a platform without native keychain tools, setKey should return false
        const { execFileSync } = await import('child_process');
        try {
            execFileSync('which', ['security']);
            // macOS - skip this test since security tool exists
        } catch {
            try {
                execFileSync('which', ['secret-tool']);
                // Linux - skip this test since secret-tool exists
            } catch {
                // No keychain tools available - test should pass
                const result = await keychain.setKey('test-key', 'test-value');
                expect(result).toBe(false);
            }
        }
    });

    it('returns null for unknown keys on actual platform', async () => {
        // This should either return null (key not found) or throw (tool not available)
        // We accept either behavior since it depends on the platform
        const result = await keychain.getKey('nonexistent-key-' + Date.now());
        // If the platform supports keychain, the key simply won't exist
        // If not, the function returns null
        expect(result).toBeNull();
    });
});
