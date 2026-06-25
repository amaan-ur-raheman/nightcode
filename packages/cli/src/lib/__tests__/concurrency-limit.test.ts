import { describe, it, expect } from 'vitest';
import { detectConflict } from '../concurrency-limit';

describe('concurrency-limit conflict detection', () => {
    it('should not conflict for non-file-modifying tools', () => {
        expect(
            detectConflict(
                'run_command',
                { action: 'bash', command: 'echo 1' },
                'run_command',
                {
                    action: 'bash',
                    command: 'echo 1',
                },
            ),
        ).toBe(false);
        expect(
            detectConflict('write_file', { path: 'a.txt' }, 'run_command', {
                action: 'bash',
                command: 'echo 1',
            }),
        ).toBe(false);
    });

    it('should conflict when two tools target the same file', () => {
        expect(
            detectConflict('write_file', { path: 'a.txt' }, 'edit_file', {
                path: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('write_file', { path: 'a.txt' }, 'edit_file', {
                filePath: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('write_file', { path: 'a.txt' }, 'edit_file', {
                file: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('write_file', { path: 'a.txt' }, 'edit_file', {
                target: 'a.txt',
            }),
        ).toBe(true);
    });

    it('should normalize paths correctly', () => {
        expect(
            detectConflict('write_file', { path: './a.txt' }, 'edit_file', {
                path: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('write_file', { path: 'a.txt/' }, 'edit_file', {
                path: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('write_file', { path: 'a//b.txt' }, 'edit_file', {
                path: 'a/b.txt',
            }),
        ).toBe(true);
    });

    it('should detect conflicts symmetrically for edit_file with move action (source vs source, source vs destination, destination vs destination, destination vs source)', () => {
        // edit_file with move action inputs:
        // uses from/source for source, and destPath/path for destination

        // 1. Source (edit_file A) vs Source (edit_file B)
        expect(
            detectConflict(
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/new.txt',
                },
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/other.txt',
                },
            ),
        ).toBe(true);

        // 2. Destination (edit_file A) vs Destination (edit_file B)
        expect(
            detectConflict(
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/new.txt',
                },
                'edit_file',
                {
                    action: 'move',
                    from: 'src/other.txt',
                    destPath: 'dest/new.txt',
                },
            ),
        ).toBe(true);

        // 3. Source (edit_file A) vs Destination (edit_file B)
        expect(
            detectConflict(
                'edit_file',
                {
                    action: 'move',
                    from: 'dest/new.txt',
                    destPath: 'dest/other.txt',
                },
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/new.txt',
                },
            ),
        ).toBe(true);

        // 4. Source (edit_file) vs normal write_file (target conflict)
        expect(
            detectConflict(
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/new.txt',
                },
                'write_file',
                { path: 'src/old.txt' },
            ),
        ).toBe(true);

        expect(
            detectConflict(
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/new.txt',
                },
                'write_file',
                { path: 'dest/new.txt' },
            ),
        ).toBe(true);

        // 5. Symmetric: write_file vs edit_file
        expect(
            detectConflict(
                'write_file',
                { path: 'dest/new.txt' },
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/new.txt',
                },
            ),
        ).toBe(true);

        // 6. No conflict
        expect(
            detectConflict(
                'edit_file',
                {
                    action: 'move',
                    from: 'src/old.txt',
                    destPath: 'dest/new.txt',
                },
                'edit_file',
                {
                    action: 'move',
                    from: 'src/other.txt',
                    destPath: 'dest/other.txt',
                },
            ),
        ).toBe(false);
    });
});
