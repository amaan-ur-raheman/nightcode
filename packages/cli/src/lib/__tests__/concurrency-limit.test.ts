import { describe, it, expect } from 'vitest';
import { detectConflict } from '../concurrency-limit';

describe('concurrency-limit conflict detection', () => {
    it('should not conflict for non-file-modifying tools', () => {
        expect(
            detectConflict('bash', { command: 'echo 1' }, 'bash', {
                command: 'echo 1',
            }),
        ).toBe(false);
        expect(
            detectConflict('writeFile', { path: 'a.txt' }, 'bash', {
                command: 'echo 1',
            }),
        ).toBe(false);
    });

    it('should conflict when two tools target the same file', () => {
        expect(
            detectConflict('writeFile', { path: 'a.txt' }, 'editFile', {
                path: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('writeFile', { path: 'a.txt' }, 'editFile', {
                filePath: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('writeFile', { path: 'a.txt' }, 'editFile', {
                file: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('writeFile', { path: 'a.txt' }, 'editFile', {
                target: 'a.txt',
            }),
        ).toBe(true);
    });

    it('should normalize paths correctly', () => {
        expect(
            detectConflict('writeFile', { path: './a.txt' }, 'editFile', {
                path: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('writeFile', { path: 'a.txt/' }, 'editFile', {
                path: 'a.txt',
            }),
        ).toBe(true);
        expect(
            detectConflict('writeFile', { path: 'a//b.txt' }, 'editFile', {
                path: 'a/b.txt',
            }),
        ).toBe(true);
    });

    it('should detect conflicts symmetrically for moveFile (source vs source, source vs destination, destination vs destination, destination vs source)', () => {
        // moveFile inputs:
        // moveFile uses from/source for source, and to/path for destination

        // 1. Source (moveFile A) vs Source (moveFile B)
        expect(
            detectConflict(
                'moveFile',
                { source: 'src/old.txt', to: 'dest/new.txt' },
                'moveFile',
                { from: 'src/old.txt', path: 'dest/other.txt' },
            ),
        ).toBe(true);

        // 2. Destination (moveFile A) vs Destination (moveFile B)
        expect(
            detectConflict(
                'moveFile',
                { source: 'src/old.txt', to: 'dest/new.txt' },
                'moveFile',
                { from: 'src/other.txt', path: 'dest/new.txt' },
            ),
        ).toBe(true);

        // 3. Source (moveFile A) vs Destination (moveFile B)
        expect(
            detectConflict(
                'moveFile',
                { source: 'dest/new.txt', to: 'dest/other.txt' },
                'moveFile',
                { from: 'src/old.txt', to: 'dest/new.txt' },
            ),
        ).toBe(true);

        // 4. Source (moveFile) vs normal writeFile (target conflict)
        expect(
            detectConflict(
                'moveFile',
                { source: 'src/old.txt', to: 'dest/new.txt' },
                'writeFile',
                { path: 'src/old.txt' },
            ),
        ).toBe(true);

        expect(
            detectConflict(
                'moveFile',
                { source: 'src/old.txt', to: 'dest/new.txt' },
                'writeFile',
                { path: 'dest/new.txt' },
            ),
        ).toBe(true);

        // 5. Symmetric: writeFile vs moveFile
        expect(
            detectConflict('writeFile', { path: 'dest/new.txt' }, 'moveFile', {
                source: 'src/old.txt',
                to: 'dest/new.txt',
            }),
        ).toBe(true);

        // 6. No conflict
        expect(
            detectConflict(
                'moveFile',
                { source: 'src/old.txt', to: 'dest/new.txt' },
                'moveFile',
                { source: 'src/other.txt', to: 'dest/other.txt' },
            ),
        ).toBe(false);
    });
});
