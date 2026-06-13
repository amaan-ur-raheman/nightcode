import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('git-workflow', () => {
    const mockRunGit = vi.fn();
    const mockScanFilesForSecrets = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        mockRunGit.mockReset();
        mockScanFilesForSecrets.mockReset();
        vi.doMock('../tools/utils', async (importOriginal) => {
            const orig =
                await importOriginal<typeof import('../tools/utils')>();
            return { ...orig, runGit: mockRunGit };
        });
        vi.doMock('../tools/secret-scan', async (importOriginal) => {
            const orig =
                await importOriginal<typeof import('../tools/secret-scan')>();
            return { ...orig, scanFilesForSecrets: mockScanFilesForSecrets };
        });
    });

    describe('getGitState', () => {
        it('returns clean state on main branch', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'main',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'feat: add feature',
                    stderr: '',
                });

            const { getGitState } = await import('../git-workflow');
            const state = await getGitState();

            expect(state).toEqual({
                branch: 'main',
                isDirty: false,
                hasUntracked: false,
                lastCommit: 'feat: add feature',
                isOnMain: true,
            });
        });

        it('detects dirty state with modifications', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'feature-branch',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: ' M src/app.ts\n',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'fix: bug',
                    stderr: '',
                });

            const { getGitState } = await import('../git-workflow');
            const state = await getGitState();

            expect(state.branch).toBe('feature-branch');
            expect(state.isDirty).toBe(true);
            expect(state.hasUntracked).toBe(false);
            expect(state.isOnMain).toBe(false);
        });

        it('detects untracked files', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'main',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '?? new-file.ts\n',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'latest commit',
                    stderr: '',
                });

            const { getGitState } = await import('../git-workflow');
            const state = await getGitState();

            expect(state.isDirty).toBe(true);
            expect(state.hasUntracked).toBe(true);
        });

        it('handles detached HEAD state', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'some commit',
                    stderr: '',
                });

            const { getGitState } = await import('../git-workflow');
            const state = await getGitState();

            expect(state.branch).toBe('detached');
            expect(state.isOnMain).toBe(false);
        });

        it('recognizes master as main branch', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'master',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'commit',
                    stderr: '',
                });

            const { getGitState } = await import('../git-workflow');
            const state = await getGitState();
            expect(state.isOnMain).toBe(true);
        });

        it('recognizes develop as main branch', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'develop',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'commit',
                    stderr: '',
                });

            const { getGitState } = await import('../git-workflow');
            const state = await getGitState();
            expect(state.isOnMain).toBe(true);
        });

        it('combines multiple status indicators', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'main',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: ' M src/app.ts\n?? new-file.ts\n D old-file.ts\n',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'commit msg',
                    stderr: '',
                });

            const { getGitState } = await import('../git-workflow');
            const state = await getGitState();

            expect(state.isDirty).toBe(true);
            expect(state.hasUntracked).toBe(true);
            expect(state.isOnMain).toBe(true);
        });
    });

    describe('createFeatureBranch', () => {
        it('creates a branch with correct naming convention', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });

            const { createFeatureBranch } = await import('../git-workflow');
            const branchName = await createFeatureBranch('Fix login bug');

            expect(branchName).toMatch(/^ai\/fix-login-bug-/);
            expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
                'checkout',
                '-b',
                branchName,
            ]);
        });

        it('sanitizes special characters in slug', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });

            const { createFeatureBranch } = await import('../git-workflow');
            const branchName = await createFeatureBranch(
                'Fix: login & auth!!! (v2.0)',
            );

            expect(branchName).toMatch(/^ai\/fix-login-auth-v2-0-/);
            // No special characters in the slug
            expect(branchName).not.toMatch(/[!:()&!]/);
        });

        it('truncates long descriptions to 40 chars', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });

            const { createFeatureBranch } = await import('../git-workflow');
            const longDesc =
                'This is a very long description that should be truncated at forty characters';
            const branchName = await createFeatureBranch(longDesc);

            const slug = branchName
                .replace(/^ai\//, '')
                .replace(/-[a-z0-9]+$/, '');
            expect(slug.length).toBeLessThanOrEqual(40);
        });

        it('throws on git checkout failure', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 1,
                stdout: '',
                stderr: 'fatal: a branch named already exists',
            });

            const { createFeatureBranch } = await import('../git-workflow');
            await expect(
                createFeatureBranch('duplicate branch'),
            ).rejects.toThrow('Failed to create branch');
        });

        it('uses stderr as error message when stdout is empty', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 1,
                stdout: '',
                stderr: 'branch already exists',
            });

            const { createFeatureBranch } = await import('../git-workflow');
            await expect(createFeatureBranch('test')).rejects.toThrow(
                'branch already exists',
            );
        });

        it('uses stdout as error message when stderr is empty', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 1,
                stdout: 'some error on stdout',
                stderr: '',
            });

            const { createFeatureBranch } = await import('../git-workflow');
            await expect(createFeatureBranch('test')).rejects.toThrow(
                'some error on stdout',
            );
        });
    });

    describe('preCommitSecretScan', () => {
        it('returns empty when no files provided and no staged files', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: '',
            });

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan([]);

            expect(result).toEqual({
                blocked: false,
                high: 0,
                medium: 0,
                low: 0,
                matches: [],
            });
            expect(mockScanFilesForSecrets).not.toHaveBeenCalled();
        });

        it('scans staged files when no files provided', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'src/app.ts\nsrc/utils.ts',
                stderr: '',
            });
            mockScanFilesForSecrets.mockResolvedValueOnce([]);

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan([]);

            expect(mockScanFilesForSecrets).toHaveBeenCalledWith(
                ['src/app.ts', 'src/utils.ts'],
                process.cwd(),
            );
            expect(result.blocked).toBe(false);
        });

        it('scans specific files directly', async () => {
            mockScanFilesForSecrets.mockResolvedValueOnce([]);

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan([
                'src/app.ts',
                'config.ts',
            ]);

            expect(mockRunGit).not.toHaveBeenCalled();
            expect(mockScanFilesForSecrets).toHaveBeenCalledWith(
                ['src/app.ts', 'config.ts'],
                process.cwd(),
            );
            expect(result.blocked).toBe(false);
        });

        it('blocks commit on high-severity secrets', async () => {
            mockScanFilesForSecrets.mockResolvedValueOnce([
                {
                    file: 'src/config.ts',
                    line: 5,
                    type: 'API Key',
                    snippet: 'api_key = "sk-1234567890"',
                    severity: 'high',
                },
                {
                    file: 'src/app.ts',
                    line: 12,
                    type: 'AWS Access Key',
                    snippet: 'AKIAIOSFODNN7EXAMPLE',
                    severity: 'high',
                },
            ]);

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan(['src/config.ts']);

            expect(result.blocked).toBe(true);
            expect(result.high).toBe(2);
            expect(result.medium).toBe(0);
            expect(result.low).toBe(0);
            expect(result.matches).toHaveLength(2);
            expect(result.matches[0]!.severity).toBe('high');
        });

        it('does not block on medium/low severity secrets', async () => {
            mockScanFilesForSecrets.mockResolvedValueOnce([
                {
                    file: '.env',
                    line: 1,
                    type: 'Database URL',
                    snippet: 'postgres://localhost:5432/db',
                    severity: 'medium',
                },
                {
                    file: 'config.ts',
                    line: 3,
                    type: 'Generic Secret',
                    snippet: 'key: "some-long-value-here"',
                    severity: 'low',
                },
            ]);

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan(['.env']);

            expect(result.blocked).toBe(false);
            expect(result.high).toBe(0);
            expect(result.medium).toBe(1);
            expect(result.low).toBe(1);
            expect(result.matches).toHaveLength(2);
        });

        it('handles mixed severity secrets correctly', async () => {
            mockScanFilesForSecrets.mockResolvedValueOnce([
                {
                    file: 'a.ts',
                    line: 1,
                    type: 'API Key',
                    snippet: 'key',
                    severity: 'high',
                },
                {
                    file: 'b.ts',
                    line: 2,
                    type: 'Password',
                    snippet: 'pwd',
                    severity: 'medium',
                },
                {
                    file: 'c.ts',
                    line: 3,
                    type: 'Generic Secret',
                    snippet: 'key',
                    severity: 'low',
                },
            ]);

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan(['a.ts', 'b.ts', 'c.ts']);

            expect(result.blocked).toBe(true);
            expect(result.high).toBe(1);
            expect(result.medium).toBe(1);
            expect(result.low).toBe(1);
            expect(result.matches).toHaveLength(3);
        });

        it('handles empty staged files output gracefully', async () => {
            // git diff --cached returns empty (only whitespace)
            mockRunGit.mockResolvedValueOnce({
                exitCode: 0,
                stdout: '  \n  ',
                stderr: '',
            });

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan([]);

            expect(result.blocked).toBe(false);
            expect(result.matches).toHaveLength(0);
            expect(mockScanFilesForSecrets).not.toHaveBeenCalled();
        });

        it('handles git diff failure gracefully', async () => {
            mockRunGit.mockResolvedValueOnce({
                exitCode: 128,
                stdout: '',
                stderr: 'not a git repository',
            });

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan([]);

            expect(result.blocked).toBe(false);
            expect(result.matches).toHaveLength(0);
        });

        it('returns correct match metadata', async () => {
            mockScanFilesForSecrets.mockResolvedValueOnce([
                {
                    file: 'secrets.yaml',
                    line: 42,
                    type: 'GitHub Token',
                    snippet: 'ghp_abcdef1234567890',
                    severity: 'high',
                },
            ]);

            const { preCommitSecretScan } = await import('../git-workflow');
            const result = await preCommitSecretScan(['secrets.yaml']);

            expect(result.matches[0]).toEqual({
                file: 'secrets.yaml',
                line: 42,
                type: 'GitHub Token',
                severity: 'high',
            });
        });
    });

    describe('generatePRSummary', () => {
        it('generates summary with commits against main', async () => {
            mockRunGit
                // rev-parse --verify main
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc123',
                    stderr: '',
                })
                // log main..HEAD --oneline
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc123 feat: add login\ndef456 fix: validation',
                    stderr: '',
                })
                // diff main...HEAD --stat
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: ' src/app.ts  | 10 ++++\n src/auth.ts |  5 +++\n 2 files changed, 15 insertions(+)',
                    stderr: '',
                })
                // branch --show-current
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'ai/feature-branch',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(summary.title).toBe('feat: add login');
            expect(summary.commits).toHaveLength(2);
            expect(summary.stats.filesChanged).toBe(2);
            expect(summary.stats.insertions).toBe(15);
            expect(summary.body).toContain('## Changes');
            expect(summary.body).toContain('- abc123 feat: add login');
            expect(summary.body).toContain('- def456 fix: validation');
        });

        it('falls back to master when main does not exist', async () => {
            mockRunGit
                // rev-parse --verify main (fails)
                .mockResolvedValueOnce({
                    exitCode: 1,
                    stdout: '',
                    stderr: 'unknown revision',
                })
                // rev-parse --verify master (succeeds)
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                // log master..HEAD --oneline
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc123 initial commit',
                    stderr: '',
                })
                // diff master...HEAD --stat
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: ' 1 file changed, 1 insertion(+)',
                    stderr: '',
                })
                // branch --show-current
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'my-feature',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(mockRunGit).toHaveBeenCalledWith(process.cwd(), [
                'log',
                'master..HEAD',
                '--oneline',
            ]);
            expect(summary.title).toBe('initial commit');
        });

        it('handles no commits with fallback title', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'ai/my-branch',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(summary.title).toBe('Changes from ai/my-branch');
            expect(summary.commits).toEqual([]);
            expect(summary.body).toContain('No commits yet.');
        });

        it('parses diffstat with insertions and deletions', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc refactor auth module',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '2 files changed, 10 insertions(+), 5 deletions(-)',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'refactor',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(summary.stats.filesChanged).toBe(2);
            expect(summary.stats.insertions).toBe(10);
            expect(summary.stats.deletions).toBe(5);
        });

        it('handles malformed diffstat gracefully', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc empty commit',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'completely unexpected output',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'branch',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(summary.stats).toEqual({
                filesChanged: 0,
                insertions: 0,
                deletions: 0,
            });
        });

        it('parses diffstat with only insertions', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc add feature',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '1 file changed, 10 insertions(+)',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'feature',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(summary.stats.filesChanged).toBe(1);
            expect(summary.stats.insertions).toBe(10);
            expect(summary.stats.deletions).toBe(0);
        });

        it('parses diffstat with only deletions', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc remove old code',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '3 files changed, 5 deletions(-)',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'cleanup',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(summary.stats.filesChanged).toBe(3);
            expect(summary.stats.insertions).toBe(0);
            expect(summary.stats.deletions).toBe(5);
        });

        it('handles diffstat with no changes', async () => {
            mockRunGit
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'abc empty commit',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: 'branch',
                    stderr: '',
                });

            const { generatePRSummary } = await import('../git-workflow');
            const summary = await generatePRSummary();

            expect(summary.stats).toEqual({
                filesChanged: 0,
                insertions: 0,
                deletions: 0,
            });
        });
    });
});
