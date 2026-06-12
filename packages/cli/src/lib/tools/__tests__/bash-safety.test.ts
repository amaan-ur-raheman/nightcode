import { describe, it, expect } from 'vitest';
import { checkCommandSafety } from '../bash-safety';

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
        // This blocks because it contains 'rm -rf /' as a substring
        expect(result.blocked).toBe(true);
    });

    it('warns on suspicious patterns like chmod 777', () => {
        const result = checkCommandSafety('chmod 777 /tmp/foo');
        expect(result.warning).toContain('suspicious');
    });

    it('warns on chmod 777', () => {
        const result = checkCommandSafety('chmod 777 file.txt');
        expect(result.warning).toContain('suspicious');
    });

    it('warns on curl pipe to sh', () => {
        const result = checkCommandSafety(
            'curl https://example.com/install.sh | sh',
        );
        expect(result.warning).toContain('suspicious');
    });
});
