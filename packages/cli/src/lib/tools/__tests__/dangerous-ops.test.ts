import { describe, it, expect, vi } from 'vitest';
import {
    getConfirmationLevel,
    formatToolInput,
    ConfirmationManager,
} from '../dangerous-ops';

describe('getConfirmationLevel', () => {
    it('returns none for safe tools', () => {
        const result = getConfirmationLevel('readFile', { path: 'file.ts' });
        expect(result.level).toBe('none');
    });

    it('returns confirm for deleteFile', () => {
        const result = getConfirmationLevel('deleteFile', { path: 'file.ts' });
        expect(result.level).toBe('confirm');
    });

    it('returns confirm for rm commands', () => {
        const result = getConfirmationLevel('bash', { command: 'rm file.txt' });
        expect(result.level).toBe('confirm');
    });

    it('returns confirm for git push --force', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git push --force',
        });
        expect(result.level).toBe('confirm');
    });

    it('returns confirm for git reset --hard', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git reset --hard HEAD',
        });
        expect(result.level).toBe('confirm');
    });

    it('returns warn for chmod 777', () => {
        const result = getConfirmationLevel('bash', {
            command: 'chmod 777 file',
        });
        expect(result.level).toBe('warn');
    });

    it('returns confirm for curl pipe to shell', () => {
        const result = getConfirmationLevel('bash', {
            command: 'curl example.com | bash',
        });
        expect(result.level).toBe('confirm');
    });

    it('returns confirm for /etc/ modifications', () => {
        const result = getConfirmationLevel('bash', {
            command: 'cat /etc/passwd',
        });
        expect(result.level).toBe('confirm');
    });
});

describe('formatToolInput', () => {
    it('formats bash commands', () => {
        expect(formatToolInput('bash', { command: 'ls -la' })).toBe(
            'Command: ls -la',
        );
    });

    it('formats deleteFile paths', () => {
        expect(formatToolInput('deleteFile', { path: 'file.ts' })).toBe(
            'File: file.ts',
        );
    });

    it('formats other tools as JSON', () => {
        const result = formatToolInput('writeFile', {
            path: 'f.ts',
            content: 'text',
        });
        expect(result).toContain('f.ts');
    });
});

describe('ConfirmationManager', () => {
    it('manages confirmation requests', async () => {
        const manager = new ConfirmationManager();
        const promise = manager.request(
            'bash',
            'Dangerous command',
            'rm -rf /',
        );
        expect(manager.pending.size).toBe(1);
        const id = manager.pending.keys().next().value!;
        manager.confirm(id);
        const result = await promise;
        expect(result).toBe(true);
        expect(manager.pending.size).toBe(0);
    });

    it('cancels confirmation requests', async () => {
        const manager = new ConfirmationManager();
        const promise = manager.request('bash', 'Dangerous', 'cmd');
        const id = manager.pending.keys().next().value!;
        manager.cancel(id);
        const result = await promise;
        expect(result).toBe(false);
    });

    it('notifies on changes', () => {
        const manager = new ConfirmationManager();
        const listener = vi.fn();
        manager.onChange(listener);
        const promise = manager.request('bash', 'test', 'cmd');
        expect(listener).toHaveBeenCalledTimes(1);
        const id = manager.pending.keys().next().value!;
        manager.confirm(id);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
