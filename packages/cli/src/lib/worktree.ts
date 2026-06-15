import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { runGit } from './tools/utils';
import { debug } from './debug';

// Fallback git identity environment variables to ensure commits succeed
const GIT_IDENTITY_ENV = {
    GIT_AUTHOR_NAME: 'NightCode Agent',
    GIT_AUTHOR_EMAIL: 'agent@nightcode.ai',
    GIT_COMMITTER_NAME: 'NightCode Agent',
    GIT_COMMITTER_EMAIL: 'agent@nightcode.ai',
};

const WORKTREE_ROOT = join(homedir(), '.nightcode', 'worktrees');

/**
 * Checks if the given directory is inside a Git repository.
 */
async function isGitRepository(cwd: string): Promise<boolean> {
    try {
        const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
        return result.exitCode === 0 && result.stdout.trim() === 'true';
    } catch {
        return false;
    }
}

/**
 * Sets up a git worktree for the given agent.
 * Checks out a new branch pointing to HEAD and applies the parent's current dirty changes.
 */
export async function setupWorktree(agentId: string, parentCwd: string): Promise<string> {
    const isGit = await isGitRepository(parentCwd);
    if (!isGit) {
        debug.log('workspace', `Directory ${parentCwd} is not a Git repository. Skipping worktree creation.`);
        return parentCwd;
    }

    const cleanAgentId = agentId.replace(/[^a-zA-Z0-9]/g, '_');
    const worktreePath = join(WORKTREE_ROOT, `worktree-${cleanAgentId}`);
    const branchName = `nightcode/worktree-${cleanAgentId}`;

    try {
        // 1. Create the worktrees container directory if it doesn't exist
        await mkdir(WORKTREE_ROOT, { recursive: true });

        debug.log('workspace', `Creating worktree at ${worktreePath} on branch ${branchName} from parent ${parentCwd}`);

        // 2. Add git worktree based on parent's HEAD
        const addResult = await runGit(parentCwd, [
            'worktree',
            'add',
            '-b',
            branchName,
            worktreePath,
            'HEAD',
        ]);

        if (addResult.exitCode !== 0) {
            throw new Error(`Failed to create git worktree: ${addResult.stderr}`);
        }

        // 3. Capture and apply parent's dirty (staged + unstaged) changes to the worktree
        const diffResult = await runGit(parentCwd, ['diff', 'HEAD']);
        if (diffResult.exitCode === 0 && diffResult.stdout.trim()) {
            debug.log('workspace', 'Applying parent unstaged/staged changes to the worktree');
            const patchPath = join(worktreePath, 'parent.patch');
            await writeFile(patchPath, diffResult.stdout, 'utf-8');
            
            const applyResult = await runGit(worktreePath, [
                'apply',
                '--whitespace=nowarn',
                'parent.patch',
            ]);

            await rm(patchPath, { force: true });

            if (applyResult.exitCode !== 0) {
                debug.log('workspace', `Warning: Failed to apply parent changes to worktree: ${applyResult.stderr}`);
            }
        }

        return worktreePath;
    } catch (error) {
        debug.log('workspace', `Failed to setup worktree for agent ${agentId}: ${error}`);
        // Cleanup on failure
        try {
            await runGit(parentCwd, ['worktree', 'remove', '--force', worktreePath]);
            await runGit(parentCwd, ['branch', '-D', branchName]);
        } catch {}
        throw error;
    }
}

/**
 * Tears down the git worktree. If mergeChanges is true, commits changes and merges back to the parent.
 */
export async function teardownWorktree(
    agentId: string,
    worktreePath: string,
    parentCwd: string,
    mergeChanges: boolean,
): Promise<void> {
    if (worktreePath === parentCwd) {
        // No worktree was created (fallback case)
        return;
    }

    const cleanAgentId = agentId.replace(/[^a-zA-Z0-9]/g, '_');
    const branchName = `nightcode/worktree-${cleanAgentId}`;

    debug.log('workspace', `Tearing down worktree at ${worktreePath}. mergeChanges=${mergeChanges}`);

    try {
        if (mergeChanges) {
            // 1. Check if the worktree has any changes to commit
            const statusResult = await runGit(worktreePath, ['status', '--porcelain']);
            if (statusResult.stdout.trim()) {
                debug.log('workspace', `Committing worktree changes for agent ${agentId}`);
                await runGit(worktreePath, ['add', '-A']);
                const commitResult = await runGit(
                    worktreePath,
                    [
                        'commit',
                        '-m',
                        `Auto-commit changes from subagent ${agentId}`,
                    ],
                    GIT_IDENTITY_ENV,
                );
                if (commitResult.exitCode !== 0) {
                    throw new Error(`Failed to commit changes in worktree: ${commitResult.stderr}`);
                }
            }

            // 2. Merge changes back into parent repository
            debug.log('workspace', `Merging worktree branch ${branchName} back into parent repository`);
            const mergeResult = await runGit(parentCwd, [
                'merge',
                branchName,
                '--no-edit',
            ]);

            if (mergeResult.exitCode !== 0) {
                // Merge failed or has conflicts. Abort to keep parent clean.
                await runGit(parentCwd, ['merge', '--abort']);
                throw new Error(`Merge conflict or error merging agent changes: ${mergeResult.stderr}`);
            }
        }
    } catch (error) {
        debug.log('workspace', `Error during worktree merge/teardown: ${error}`);
        throw error;
    } finally {
        // 3. Remove worktree and temporary branch
        try {
            const removeResult = await runGit(parentCwd, [
                'worktree',
                'remove',
                '--force',
                worktreePath,
            ]);
            if (removeResult.exitCode !== 0) {
                debug.log('workspace', `Warning: Failed to remove worktree path: ${removeResult.stderr}`);
            }
        } catch (err) {
            debug.log('workspace', `Warning: Failed to remove worktree path: ${err}`);
        }

        try {
            const deleteResult = await runGit(parentCwd, ['branch', '-D', branchName]);
            if (deleteResult.exitCode !== 0) {
                debug.log('workspace', `Warning: Failed to delete branch ${branchName}: ${deleteResult.stderr}`);
            }
        } catch (err) {
            debug.log('workspace', `Warning: Failed to delete branch ${branchName}: ${err}`);
        }

        try {
            await rm(worktreePath, { recursive: true, force: true });
        } catch {}
    }
}
