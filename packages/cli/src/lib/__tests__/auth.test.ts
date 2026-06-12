import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const AUTH_FILE = join(homedir(), '.nightcode', 'auth.json');

describe('Auth Module', () => {
    beforeEach(() => {
        try {
            unlinkSync(AUTH_FILE);
        } catch {}
    });

    afterEach(() => {
        try {
            unlinkSync(AUTH_FILE);
        } catch {}
    });

    it('returns null when no auth file exists', async () => {
        const { getAuth } = await import('../auth');
        const auth = getAuth();
        expect(auth).toBeNull();
    });

    it('saves and retrieves auth token', async () => {
        const { saveAuth, getAuth } = await import('../auth');
        saveAuth({ token: 'test-token-123' });
        const auth = getAuth();
        expect(auth).not.toBeNull();
        expect(auth!.token).toBe('test-token-123');
    });

    it('clearAuth removes the auth file', async () => {
        const { saveAuth, getAuth, clearAuth } = await import('../auth');
        saveAuth({ token: 'test-token' });
        expect(getAuth()).not.toBeNull();
        clearAuth();
        expect(getAuth()).toBeNull();
    });

    it('handles corrupted auth file gracefully', async () => {
        mkdirSync(join(homedir(), '.nightcode'), { recursive: true });
        writeFileSync(AUTH_FILE, 'not-json{}!', 'utf-8');
        const { getAuth } = await import('../auth');
        const auth = getAuth();
        expect(auth).toBeNull();
    });

    it('caches the auth value and returns same object', async () => {
        const { saveAuth, getAuth } = await import('../auth');
        saveAuth({ token: 'token' });
        const first = getAuth();
        const second = getAuth();
        expect(first).toBe(second);
    });
});
