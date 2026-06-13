import { describe, it, expect, vi } from 'vitest';
import {
    getConfirmationLevel,
    formatToolInput,
    getAccessPath,
    getPatterns,
    ConfirmationManager,
    checkCommandSafety,
} from '../dangerous-ops';

describe('checkCommandSafety', () => {
    it('allows safe commands', () => {
        const result = checkCommandSafety('ls -la');
        expect(result.safe).toBe(true);
        expect(result.blocked).toBe(false);
        expect(result.warning).toBeUndefined();
    });

    it('allows git commands', () => {
        const result = checkCommandSafety('git status');
        expect(result.safe).toBe(true);
        expect(result.blocked).toBe(false);
    });

    it('blocks rm -rf /', () => {
        const result = checkCommandSafety('rm -rf /');
        expect(result.blocked).toBe(true);
        expect(result.warning).toContain('Blocked');
    });

    it('blocks rm -rf /*', () => {
        const result = checkCommandSafety('rm -rf /*');
        expect(result.blocked).toBe(true);
    });

    it('blocks rm -rf ~', () => {
        const result = checkCommandSafety('rm -rf ~');
        expect(result.blocked).toBe(true);
    });

    it('blocks mkfs commands', () => {
        const result = checkCommandSafety('mkfs.ext4 /dev/sda1');
        expect(result.blocked).toBe(true);
    });

    it('blocks dd commands', () => {
        const result = checkCommandSafety('dd if=/dev/zero of=/dev/sda bs=1M');
        expect(result.blocked).toBe(true);
    });

    it('blocks shutdown, reboot, halt', () => {
        expect(checkCommandSafety('shutdown -h now').blocked).toBe(true);
        expect(checkCommandSafety('reboot').blocked).toBe(true);
        expect(checkCommandSafety('halt').blocked).toBe(true);
    });

    it('warns on --force flag', () => {
        const result = checkCommandSafety('git push --force');
        expect(result.safe).toBe(true);
        expect(result.blocked).toBe(false);
        expect(result.warning).toContain('--force');
    });

    it('blocks rm with / pattern when root-like', () => {
        const result = checkCommandSafety('rm -rf /tmp/foo');
        expect(result.blocked).toBe(true);
    });

    it('warns on suspicious patterns like chmod 777', () => {
        const result = checkCommandSafety('chmod 777 /tmp/foo');
        expect(result.warning).toContain('suspicious');
    });

    it('warns on curl pipe to sh', () => {
        const result = checkCommandSafety(
            'curl https://example.com/install.sh | sh',
        );
        expect(result.warning).toContain('suspicious');
    });
});

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

    it('returns confirm for git push (any)', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git push origin main',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Push to remote repository');
    });

    it('returns confirm for git checkout', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git checkout feature-branch',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Git checkout (switches branch)');
    });

    it('returns confirm for git add .', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git add .',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Stage all changes');
    });

    it('returns confirm for git add -A', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git add -A',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Stage all changes');
    });

    it('returns confirm for git add --all', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git add --all',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Stage all changes');
    });

    it('returns confirm for git add -u', () => {
        const result = getConfirmationLevel('bash', {
            command: 'git add -u',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Stage all changes');
    });

    it('returns confirm for gitCommit tool', () => {
        const result = getConfirmationLevel('gitCommit', {
            message: 'Fix bug',
            files: ['src/app.ts'],
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Git commit (creates a commit)');
    });

    it('returns confirm for gitBranch checkout action', () => {
        const result = getConfirmationLevel('gitBranch', {
            action: 'checkout',
            name: 'feature',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Git checkout (switches branch)');
    });

    it('returns confirm for gitBranch delete action', () => {
        const result = getConfirmationLevel('gitBranch', {
            action: 'delete',
            name: 'old-branch',
        });
        expect(result.level).toBe('confirm');
        expect(result.reason).toBe('Git branch delete');
    });

    it('returns none for gitBranch list action', () => {
        const result = getConfirmationLevel('gitBranch', {
            action: 'list',
        });
        expect(result.level).toBe('none');
    });

    it('returns none for gitBranch create action', () => {
        const result = getConfirmationLevel('gitBranch', {
            action: 'create',
            name: 'new-branch',
        });
        expect(result.level).toBe('none');
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

    it('formats gitCommit with message and files', () => {
        const result = formatToolInput('gitCommit', {
            message: 'Fix bug',
            files: ['src/app.ts', 'src/utils.ts'],
        });
        expect(result).toBe(
            'Message: "Fix bug" | Files: src/app.ts, src/utils.ts',
        );
    });

    it('formats gitCommit with message only', () => {
        const result = formatToolInput('gitCommit', {
            message: 'Initial commit',
        });
        expect(result).toBe('Message: "Initial commit"');
    });

    it('formats gitBranch', () => {
        const result = formatToolInput('gitBranch', {
            action: 'checkout',
            name: 'feature',
        });
        expect(result).toBe('Action: checkout | Branch: feature');
    });
});

describe('getAccessPath', () => {
    it('returns working directory for bash', () => {
        expect(getAccessPath('bash', { workingDirectory: '/tmp' })).toBe(
            '/tmp',
        );
    });

    it('returns file path for deleteFile', () => {
        expect(getAccessPath('deleteFile', { path: 'src/app.ts' })).toBe(
            'src/app.ts',
        );
    });

    it('returns branch name for gitBranch', () => {
        expect(getAccessPath('gitBranch', { name: 'feature' })).toBe('feature');
    });

    it('returns undefined for unknown tool', () => {
        expect(getAccessPath('readFile', { path: 'x.ts' })).toBe('x.ts');
        expect(getAccessPath('gitLog', {})).toBeUndefined();
    });
});

describe('getPatterns', () => {
    it('returns file paths for gitCommit', () => {
        expect(
            getPatterns('gitCommit', { files: ['src/a.ts', 'src/b.ts'] }),
        ).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('returns undefined for gitCommit without files', () => {
        expect(getPatterns('gitCommit', {})).toBeUndefined();
    });

    it('returns branch pattern for gitBranch', () => {
        expect(getPatterns('gitBranch', { name: 'feat' })).toEqual([
            'branch:feat',
        ]);
    });

    it('returns undefined for gitBranch list without name', () => {
        expect(getPatterns('gitBranch', { action: 'list' })).toBeUndefined();
    });

    it('returns undefined for unknown tool', () => {
        expect(getPatterns('gitLog', {})).toBeUndefined();
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
