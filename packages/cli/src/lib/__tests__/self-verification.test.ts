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
            const toolUsage = new Map<string, number>([['editFile', 15]]);
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
        it('identifies critical built-in tools', () => {
            expect(isCriticalOperation('gitCommit', {})).toBe(true);
            expect(isCriticalOperation('deleteFile', {})).toBe(true);
            expect(isCriticalOperation('readFile', {})).toBe(false);
        });

        it('identifies critical/destructive bash commands', () => {
            expect(isCriticalOperation('bash', { command: 'rm -rf foo' })).toBe(
                true,
            );
            expect(
                isCriticalOperation('bash', { command: 'git reset --hard' }),
            ).toBe(true);
            expect(
                isCriticalOperation('bash', { command: 'npm install' }),
            ).toBe(false);
        });
    });

    describe('generateVerificationPrompt', () => {
        it('creates prompt for gitCommit', () => {
            const prompt = generateVerificationPrompt('gitCommit', {}, '');
            expect(prompt).toContain('commit message');
            expect(prompt).toContain('verified');
        });

        it('creates prompt for deleteFile', () => {
            const prompt = generateVerificationPrompt(
                'deleteFile',
                { path: 'foo.ts' },
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
