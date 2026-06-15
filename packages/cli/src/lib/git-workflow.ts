import { runGit } from './tools/utils';
import { scanFilesForSecrets } from './tools/secret-scan';
import { getProjectCwd } from './workspace-context';

/**
 * Git workflow automation for NightCode.
 *
 * Provides intelligent git state management:
 * - Auto-creates feature branches when committing on main
 * - Pre-commit secret scanning to prevent accidental leaks
 * - PR summary generation from diffs and commit history
 */

export interface GitState {
    branch: string;
    isDirty: boolean;
    hasUntracked: boolean;
    lastCommit: string;
    isOnMain: boolean;
}

/**
 * Get the current git repository state.
 */
export async function getGitState(): Promise<GitState> {
    const cwd = getProjectCwd();

    const branchResult = await runGit(cwd, ['branch', '--show-current']);
    const branch = branchResult.stdout.trim() || 'detached';

    const statusResult = await runGit(cwd, ['status', '--porcelain']);
    const statusOutput = statusResult.stdout;
    const isDirty = statusOutput.length > 0;
    const hasUntracked = statusOutput.includes('??');

    const logResult = await runGit(cwd, ['log', '-1', '--format=%s']);
    const lastCommit = logResult.stdout.trim();

    const isOnMain =
        branch === 'main' || branch === 'master' || branch === 'develop';

    return { branch, isDirty, hasUntracked, lastCommit, isOnMain };
}

/**
 * Create a feature branch with a descriptive name derived from the commit message.
 * Branch naming: ai/<slug>-<timestamp>
 */
export async function createFeatureBranch(
    description: string,
): Promise<string> {
    const cwd = getProjectCwd();

    // Generate a URL-safe slug from the description
    const slug = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);

    const timestamp = Date.now().toString(36);
    const branchName = `ai/${slug}-${timestamp}`;

    const result = await runGit(cwd, ['checkout', '-b', branchName]);
    if (result.exitCode !== 0) {
        throw new Error(
            `Failed to create branch: ${result.stderr || result.stdout}`,
        );
    }

    return branchName;
}

/**
 * Pre-commit secret scan: check staged files for accidentally committed secrets.
 * Returns matches grouped by severity. Callers should block the commit if
 * high-severity secrets are found.
 */
export async function preCommitSecretScan(files: string[]): Promise<{
    blocked: boolean;
    high: number;
    medium: number;
    low: number;
    matches: Array<{
        file: string;
        line: number;
        type: string;
        severity: string;
    }>;
}> {
    const cwd = getProjectCwd();

    // If no specific files provided, scan all staged files
    let filesToScan = files;
    if (filesToScan.length === 0) {
        const stagedResult = await runGit(cwd, [
            'diff',
            '--cached',
            '--name-only',
        ]);
        if (stagedResult.exitCode === 0 && stagedResult.stdout.trim()) {
            filesToScan = stagedResult.stdout
                .trim()
                .split('\n')
                .filter((f) => f.length > 0);
        }
    }

    if (filesToScan.length === 0) {
        return { blocked: false, high: 0, medium: 0, low: 0, matches: [] };
    }

    const matches = await scanFilesForSecrets(filesToScan, cwd);

    const high = matches.filter((m) => m.severity === 'high').length;
    const medium = matches.filter((m) => m.severity === 'medium').length;
    const low = matches.filter((m) => m.severity === 'low').length;

    return {
        blocked: high > 0,
        high,
        medium,
        low,
        matches: matches.map((m) => ({
            file: m.file,
            line: m.line,
            type: m.type,
            severity: m.severity,
        })),
    };
}

/**
 * Generate a PR summary from the current branch's diff against main/master.
 */
export async function generatePRSummary(): Promise<{
    title: string;
    body: string;
    commits: string[];
    stats: { filesChanged: number; insertions: number; deletions: number };
}> {
    const cwd = getProjectCwd();

    // Determine the base branch
    const mainCheck = await runGit(cwd, ['rev-parse', '--verify', 'main']);
    let baseBranch: string;
    if (mainCheck.exitCode === 0) {
        baseBranch = 'main';
    } else {
        const masterCheck = await runGit(cwd, [
            'rev-parse',
            '--verify',
            'master',
        ]);
        if (masterCheck.exitCode === 0) {
            baseBranch = 'master';
        } else {
            throw new Error(
                'No base branch found. Expected "main" or "master" to exist.',
            );
        }
    }

    // Get commit log since base
    const logResult = await runGit(cwd, [
        'log',
        `${baseBranch}..HEAD`,
        '--oneline',
    ]);
    const commits = logResult.stdout
        .trim()
        .split('\n')
        .filter((c) => c.length > 0);

    // Get diffstat
    const diffResult = await runGit(cwd, [
        'diff',
        `${baseBranch}..HEAD`,
        '--stat',
    ]);
    const diffstat = diffResult.stdout;

    // Parse stats from diffstat summary line
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    const summaryMatch = diffstat.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(.*?\))?(?:, (\d+) deletions?\(.*?\))?/,
    );
    if (summaryMatch) {
        filesChanged = parseInt(summaryMatch[1] ?? '0', 10);
        insertions = parseInt(summaryMatch[2] ?? '0', 10);
        deletions = parseInt(summaryMatch[3] ?? '0', 10);
    }

    // Generate title from first commit or branch name
    const branchResult = await runGit(cwd, ['branch', '--show-current']);
    const branchName = branchResult.stdout.trim();
    const title =
        commits.length > 0
            ? commits[0]!.replace(/^\w+\s+/, '')
            : `Changes from ${branchName}`;

    // Generate body from commits
    const body = [
        commits.length > 0
            ? `## Changes\n${commits.map((c) => `- ${c}`).join('\n')}`
            : '## Changes\nNo commits yet.',
        '',
        diffstat,
    ].join('\n');

    return {
        title,
        body,
        commits,
        stats: { filesChanged, insertions, deletions },
    };
}
