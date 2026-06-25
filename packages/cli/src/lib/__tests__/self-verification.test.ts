import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
    verifyFileConsistency,
    calculateConfidence,
    isCriticalOperation,
    generateVerificationPrompt,
    runVerification,
} from '../self-verification';

describe('self-verification', () => {
    let tempFile: string;

    beforeEach(() => {
        tempFile = join(tmpdir(), `test-file-${Date.now()}.ts`);
    });

    afterEach(() => {
        try {
            unlinkSync(tempFile);
        } catch {}
    });

    describe('verifyFileConsistency', () => {
        it('returns invalid if file does not exist', () => {
            const result = verifyFileConsistency('/nonexistent/file.ts');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('does not exist');
        });

        it('returns valid for well-formed JSON', () => {
            const jsonFile = tempFile.replace('.ts', '.json');
            try {
                writeFileSync(jsonFile, '{"foo": "bar"}', 'utf-8');
                const result = verifyFileConsistency(jsonFile);
                expect(result.valid).toBe(true);
            } finally {
                try {
                    unlinkSync(jsonFile);
                } catch {}
            }
        });

        it('returns invalid for malformed JSON', () => {
            const jsonFile = tempFile.replace('.ts', '.json');
            try {
                writeFileSync(jsonFile, '{"foo": "bar"', 'utf-8');
                const result = verifyFileConsistency(jsonFile);
                expect(result.valid).toBe(false);
                expect(result.error).toContain('JSON');
            } finally {
                try {
                    unlinkSync(jsonFile);
                } catch {}
            }
        });

        it('checks bracket balance in TS/JS files', () => {
            writeFileSync(
                tempFile,
                'function test() { console.log("hello");',
                'utf-8',
            );
            const result = verifyFileConsistency(tempFile);
            expect(result.valid).toBe(true); // Balanced is just warning not invalidating
            expect(result.warnings[0]).toContain('Unbalanced braces');
        });

        it('warns when checkable file is empty', () => {
            writeFileSync(tempFile, '', 'utf-8');
            const result = verifyFileConsistency(tempFile);
            expect(result.valid).toBe(true);
            expect(result.warnings).toContain(
                'File is empty after modification',
            );
        });
    });

    describe('calculateConfidence', () => {
        it('gives high confidence (1.0) when no files modified and no errors', () => {
            const toolUsage = new Map<string, number>();
            const score = calculateConfidence([], toolUsage, []);
            expect(score.overall).toBe(1.0);
            expect(
                score.explanation.some((e) => e.includes('High confidence')),
            ).toBe(true);
        });

        it('lowers confidence when high edit count or errors are present', () => {
            const toolUsage = new Map<string, number>([['edit_file', 15]]);
            const score = calculateConfidence(
                ['/path/to/nonexistent.ts'],
                toolUsage,
                ['some error'],
            );
            expect(score.overall).toBeLessThan(0.8);
            expect(
                score.explanation.some((e) =>
                    e.includes('failed consistency checks'),
                ),
            ).toBe(true);
        });
    });

    describe('isCriticalOperation', () => {
        it('marks all CRITICAL_TOOLS as critical', () => {
            expect(isCriticalOperation('git_operation', {})).toBe(true);
            expect(isCriticalOperation('edit_file', {})).toBe(true);
            expect(isCriticalOperation('code_search', {})).toBe(true);
        });

        it('marks read-like and non-destructive tools as non-critical', () => {
            expect(isCriticalOperation('read_file', {})).toBe(false);
            expect(isCriticalOperation('list_files', {})).toBe(false);
            expect(isCriticalOperation('search', {})).toBe(false);
            expect(isCriticalOperation('web_search', {})).toBe(false);
            expect(isCriticalOperation('unknown_tool', {})).toBe(false);
        });

        it('marks all destructive bash commands as critical', () => {
            const destructiveCommands = [
                'rm -rf foo',
                'rmdir bar',
                'del baz.txt',
                'unlink somefile',
                'drop table users',
                'truncate log.txt',
                'git push origin main --force',
                'git reset --hard HEAD~1',
            ];
            for (const command of destructiveCommands) {
                expect(
                    isCriticalOperation('run_command', {
                        action: 'bash',
                        command,
                    }),
                ).toBe(true);
            }
        });

        it('marks non-destructive bash commands as non-critical', () => {
            const safeCommands = [
                'npm install',
                'ls -la',
                'cat file.txt',
                'grep pattern src/',
                'mkdir newdir',
                'echo hello',
                'git status',
                'git log --oneline',
                'git diff',
            ];
            for (const command of safeCommands) {
                expect(
                    isCriticalOperation('run_command', {
                        action: 'bash',
                        command,
                    }),
                ).toBe(false);
            }
        });

        it('treats edit_file actions (create/update/delete/move) as critical', () => {
            expect(isCriticalOperation('edit_file', { action: 'create' })).toBe(
                true,
            );
            expect(isCriticalOperation('edit_file', { action: 'update' })).toBe(
                true,
            );
            expect(isCriticalOperation('edit_file', { action: 'delete' })).toBe(
                true,
            );
            expect(isCriticalOperation('edit_file', { action: 'move' })).toBe(
                true,
            );
        });

        it('returns false for run_command with missing or non-string command', () => {
            expect(isCriticalOperation('run_command', {})).toBe(false);
            expect(isCriticalOperation('run_command', { action: 'bash' })).toBe(
                false,
            );
            expect(isCriticalOperation('run_command', { command: 123 })).toBe(
                false,
            );
        });
    });

    describe('generateVerificationPrompt', () => {
        it('creates prompt for gitCommit', () => {
            const prompt = generateVerificationPrompt(
                'git_operation',
                { action: 'commit', message: 'test' },
                '',
            );
            expect(prompt).toContain('commit message');
            expect(prompt).toContain('verified');
        });

        it('creates prompt for deleteFile', () => {
            const prompt = generateVerificationPrompt(
                'edit_file',
                { path: 'foo.ts', action: 'delete' },
                '',
            );
            expect(prompt).toContain('deleted');
            expect(prompt).toContain('foo.ts');
        });
    });

    describe('runVerification', () => {
        it('returns passed=true for clean run', () => {
            const result = runVerification([], new Map(), []);
            expect(result.passed).toBe(true);
            expect(result.recommendation.toLowerCase()).toContain(
                'pass verification',
            );
        });
    });
});
