import { toolInputSchemas } from '@nightcode/shared';
import { MAX_DIFF, runGit } from './utils';
import { getProjectCwd } from '../workspace-context';
import { preCommitSecretScan } from '../git-workflow';
import { reviewPrTool } from './review-pr';

export async function gitOperationTool(
    input: unknown,
    parentMode?: any,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const parsed = toolInputSchemas.git_operation.parse(input);
    const { action } = parsed;
    const cwd = getProjectCwd();

    if (action === 'status') {
        const result = await runGit(cwd, ['status', '--short', '--branch']);
        if (result.exitCode !== 0)
            return { error: result.stderr || 'git status failed' };
        return { status: result.stdout };
    }

    if (action === 'diff') {
        const { path, staged } = parsed;
        const args = ['diff'];
        if (staged) args.push('--cached');
        if (path) args.push('--', path);
        const result = await runGit(cwd, args);
        if (result.exitCode !== 0)
            return { error: result.stderr || 'git diff failed' };
        const diff = result.stdout;
        return {
            diff:
                diff.length > MAX_DIFF
                    ? diff.slice(0, MAX_DIFF) +
                      `\n...(truncated, ${diff.length} total chars)`
                    : diff,
            truncated: diff.length > MAX_DIFF,
        };
    }

    if (action === 'commit') {
        const { message, files } = parsed;
        if (!message) throw new Error('message is required for commit action');
        try {
            const filesToStage = files && files.length > 0 ? files : [];

            if (filesToStage.length > 0) {
                const addResult = await runGit(cwd, ['add', ...filesToStage]);
                if (addResult.exitCode !== 0) {
                    return {
                        success: false,
                        output: addResult.stderr || 'git add failed',
                    };
                }
            }

            const scanResult = await preCommitSecretScan(filesToStage);
            if (scanResult.blocked) {
                await runGit(cwd, ['reset', 'HEAD', ...filesToStage]).catch(
                    () => {},
                );
                const details = scanResult.matches
                    .filter((m) => m.severity === 'high')
                    .map((m) => `  ${m.file}:${m.line} — ${m.type}`)
                    .join('\n');
                return {
                    success: false,
                    output: `Commit blocked: high-severity secrets detected:\n${details}\n\nRemove secrets before committing.`,
                };
            }

            const result = await runGit(cwd, ['commit', '-m', message]);
            if (result.exitCode !== 0) {
                return {
                    success: false,
                    output:
                        result.stderr || result.stdout || 'git commit failed',
                };
            }

            const hashMatch = result.stdout.match(/\[[\w]+\s+([0-9a-f]+)\]/);
            const commitHash = hashMatch ? hashMatch[1] : undefined;

            let warnings = '';
            if (scanResult.medium > 0 || scanResult.low > 0) {
                const warnParts: string[] = [];
                if (scanResult.medium > 0)
                    warnParts.push(`${scanResult.medium} medium`);
                if (scanResult.low > 0) warnParts.push(`${scanResult.low} low`);
                warnings = `\nWarning: ${warnParts.join(', ')} severity patterns detected — review recommended.`;
            }

            return {
                success: true,
                output: result.stdout + warnings,
                commitHash,
            };
        } catch (err: any) {
            return { success: false, output: err.message };
        }
    }

    if (action === 'branch') {
        const { branchAction, branchName: name } = parsed;
        if (!branchAction)
            throw new Error('branchAction is required for branch action');
        try {
            switch (branchAction) {
                case 'create': {
                    if (!name)
                        return {
                            success: false,
                            output: 'branchName is required for create',
                        };
                    const result = await runGit(cwd, ['branch', name]);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git branch create failed',
                        };
                    return { success: true, output: `Created branch: ${name}` };
                }
                case 'list': {
                    const result = await runGit(cwd, ['branch', '--list']);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git branch list failed',
                        };
                    const branches = result.stdout
                        .split('\n')
                        .map((b: string) => b.replace(/^\*?\s*/, '').trim())
                        .filter((b: string) => b.length > 0);

                    const currentResult = await runGit(cwd, [
                        'branch',
                        '--show-current',
                    ]);
                    const currentBranch = currentResult.stdout.trim();

                    return {
                        success: true,
                        branches,
                        currentBranch,
                        output: result.stdout,
                    };
                }
                case 'delete': {
                    if (!name)
                        return {
                            success: false,
                            output: 'branchName is required for delete',
                        };
                    const result = await runGit(cwd, ['branch', '-d', name]);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git branch delete failed',
                        };
                    return { success: true, output: result.stdout };
                }
                case 'checkout': {
                    if (!name)
                        return {
                            success: false,
                            output: 'branchName is required for checkout',
                        };
                    const result = await runGit(cwd, ['checkout', name]);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git checkout failed',
                        };
                    return { success: true, output: result.stdout };
                }
            }
        } catch (err: any) {
            return { success: false, output: err.message };
        }
    }

    if (action === 'log') {
        const { limit, oneline, author } = parsed;
        try {
            const args = ['log'];
            if (oneline) args.push('--oneline');
            if (author) args.push(`--author=${author}`);
            args.push('-n', String(limit));

            const result = await runGit(cwd, args);
            if (result.exitCode !== 0) {
                return {
                    success: false,
                    commits: [],
                    output: result.stderr || 'git log failed',
                };
            }

            if (!result.stdout.trim()) {
                return { success: true, commits: [], output: '' };
            }

            const commits = result.stdout
                .split('\n')
                .filter((line: string) => line.trim())
                .map((line: string) => {
                    if (oneline) {
                        const match = line.match(/^([0-9a-f]+)\s+(.+)$/);
                        return {
                            hash: match?.[1] || '',
                            message: match?.[2] || line,
                        };
                    }
                    const hashMatch = line.match(
                        /^([0-9a-f]{40})\s+(.+?)\s+\((.+?)\s+(\d{4}-\d{2}-\d{2})\)$/,
                    );
                    if (hashMatch) {
                        return {
                            hash: hashMatch[1],
                            message: hashMatch[2],
                            author: hashMatch[3],
                            date: hashMatch[4],
                        };
                    }
                    const shortMatch = line.match(/^([0-9a-f]+)\s+(.+)$/);
                    return {
                        hash: shortMatch?.[1] || '',
                        message: shortMatch?.[2] || line,
                    };
                });

            return { success: true, commits };
        } catch (err: any) {
            return { success: false, commits: [], output: err.message };
        }
    }

    if (action === 'blame') {
        const { path: filePath, startLine, endLine } = parsed;
        if (!filePath) throw new Error('path is required for blame action');
        try {
            const args = ['blame'];
            if (startLine !== undefined && endLine !== undefined) {
                args.push('-L', `${startLine},${endLine}`);
            } else if (startLine !== undefined) {
                args.push('-L', `${startLine},+1`);
            }
            args.push(filePath);

            const result = await runGit(cwd, args);
            if (result.exitCode !== 0) {
                return {
                    success: false,
                    lines: [],
                    output: result.stderr || 'git blame failed',
                };
            }

            const lines = result.stdout
                .split('\n')
                .filter((line: string) => line.trim())
                .map((line: string, index: number) => {
                    const match = line.match(
                        /^([0-9a-f]+)\s+\((.+?)\s+\d{4}-\d{2}-\d{2}\s+(\d+)\)\s+(.*)$/,
                    );
                    if (match) {
                        return {
                            lineNumber: startLine
                                ? startLine + index
                                : index + 1,
                            author: match[2],
                            hash: match[1],
                            content: match[4],
                        };
                    }
                    return {
                        lineNumber: startLine ? startLine + index : index + 1,
                        author: 'unknown',
                        hash: '',
                        content: line,
                    };
                });

            return { success: true, lines };
        } catch (err: any) {
            return { success: false, lines: [], output: err.message };
        }
    }

    if (action === 'status_extended') {
        try {
            const statusResult = await runGit(cwd, [
                'status',
                '--porcelain=v1',
            ]);
            if (statusResult.exitCode !== 0) {
                return {
                    success: false,
                    staged: [],
                    unstaged: [],
                    untracked: [],
                    currentBranch: '',
                    output: statusResult.stderr || 'git status failed',
                };
            }
            const branchResult = await runGit(cwd, [
                'branch',
                '--show-current',
            ]);
            const currentBranch = branchResult.stdout.trim();

            const staged: string[] = [];
            const unstaged: string[] = [];
            const untracked: string[] = [];

            for (const line of statusResult.stdout.split('\n')) {
                if (!line.trim()) continue;
                const indexStatus = line[0];
                const workTreeStatus = line[1];
                const filePath = line.substring(3).trim();

                if (indexStatus === '?' && workTreeStatus === '?') {
                    untracked.push(filePath);
                } else {
                    if (indexStatus !== ' ' && indexStatus !== '?')
                        staged.push(filePath);
                    if (workTreeStatus !== ' ' && workTreeStatus !== '?')
                        unstaged.push(filePath);
                }
            }

            return {
                success: true,
                staged,
                unstaged,
                untracked,
                currentBranch,
            };
        } catch (err: any) {
            return {
                success: false,
                staged: [],
                unstaged: [],
                untracked: [],
                currentBranch: '',
                output: err.message,
            };
        }
    }

    if (action === 'operations') {
        const {
            gitOp,
            branchName: branch,
            message,
            remote,
            forceWithLease,
        } = parsed;
        if (!gitOp) throw new Error('gitOp is required for operations action');
        try {
            switch (gitOp) {
                case 'merge': {
                    if (!branch)
                        return {
                            success: false,
                            output: 'branchName is required for merge',
                        };
                    const result = await runGit(cwd, ['merge', branch]);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git merge failed',
                        };
                    return { success: true, output: result.stdout };
                }
                case 'stash': {
                    const args = ['stash'];
                    if (message) args.push('push', '-m', message);
                    else args.push('push');
                    const result = await runGit(cwd, args);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git stash failed',
                        };
                    return { success: true, output: result.stdout };
                }
                case 'stashPop': {
                    const result = await runGit(cwd, ['stash', 'pop']);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git stash pop failed',
                        };
                    return { success: true, output: result.stdout };
                }
                case 'stashList': {
                    const result = await runGit(cwd, ['stash', 'list']);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git stash list failed',
                        };
                    const stashes = result.stdout
                        .split('\n')
                        .filter((s: string) => s.trim().length > 0);
                    return {
                        success: true,
                        stashCount: stashes.length,
                        output: result.stdout,
                    };
                }
                case 'push': {
                    const args = ['push', remote];
                    if (forceWithLease) args.push('--force-with-lease');
                    const result = await runGit(cwd, args);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git push failed',
                        };
                    return { success: true, output: result.stdout };
                }
                case 'pull': {
                    const result = await runGit(cwd, ['pull', remote]);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git pull failed',
                        };
                    return { success: true, output: result.stdout };
                }
                case 'fetch': {
                    const result = await runGit(cwd, ['fetch', remote]);
                    if (result.exitCode !== 0)
                        return {
                            success: false,
                            output: result.stderr || 'git fetch failed',
                        };
                    return { success: true, output: result.stdout };
                }
            }
        } catch (err: any) {
            return { success: false, output: err.message };
        }
    }

    if (action === 'review_pr') {
        const { prUrl: url, prFocus: focus, prModel: model } = parsed;
        if (!url) throw new Error('prUrl is required for review_pr action');
        return await reviewPrTool(
            { url, focus, model },
            parentMode,
            parentModel,
            signal,
            execId,
        );
    }

    throw new Error(`Unknown action: ${action}`);
}
