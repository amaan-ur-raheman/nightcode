import { join } from 'path';
import { homedir } from 'os';
import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
import { debug } from './debug';

const TIMELINES_DIR = join(homedir(), '.nightcode', 'timelines');

export interface Snapshot {
    commitHash: string;
    messageId: string;
    parentMessageId?: string;
    timestamp: string;
}

export interface TimelineData {
    sessionId: string;
    snapshots: Record<string, Snapshot>;
}

async function runGitWithEnv(args: string[], env: Record<string, string>) {
    const proc = Bun.spawn(['git', ...args], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            ...env,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: await proc.exited,
    };
}

class TimelineManager {
    private async getTimelinePath(sessionId: string): Promise<string> {
        await mkdir(TIMELINES_DIR, { recursive: true });
        return join(TIMELINES_DIR, `${sessionId}.json`);
    }

    private async getGitDir(): Promise<string> {
        const result = await runGitWithEnv(['rev-parse', '--git-dir'], {});
        if (result.exitCode !== 0) {
            return join(process.cwd(), '.git');
        }
        // rev-parse returns a relative or absolute path — resolve it against cwd
        const gitDir = result.stdout;
        return join(process.cwd(), gitDir);
    }

    async loadTimeline(sessionId: string): Promise<TimelineData> {
        try {
            const filePath = await this.getTimelinePath(sessionId);
            const content = await readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return { sessionId, snapshots: {} };
        }
    }

    async saveTimeline(sessionId: string, data: TimelineData): Promise<void> {
        const filePath = await this.getTimelinePath(sessionId);
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    async takeSnapshot(
        sessionId: string,
        messageId: string,
        parentMessageId?: string,
    ): Promise<string | null> {
        try {
            const timeline = await this.loadTimeline(sessionId);

            // Step 1: Discover parent commit
            let parentSha: string | undefined;
            if (parentMessageId && timeline.snapshots[parentMessageId]) {
                parentSha = timeline.snapshots[parentMessageId].commitHash;
            } else {
                // Try to get latest snapshot from active timeline
                const snapshots = Object.values(timeline.snapshots);
                if (snapshots.length > 0) {
                    // Find the snapshot with the latest timestamp
                    snapshots.sort(
                        (a, b) =>
                            new Date(b.timestamp).getTime() -
                            new Date(a.timestamp).getTime(),
                    );
                    parentSha = snapshots[0]!.commitHash;
                } else {
                    // No snapshots yet, get current HEAD
                    const headResult = await runGitWithEnv(
                        ['rev-parse', 'HEAD'],
                        {},
                    );
                    if (headResult.exitCode === 0) {
                        parentSha = headResult.stdout.trim();
                    }
                }
            }

            // Step 2: stage files to temporary index
            const gitDir = await this.getGitDir();
            const fullTempIndex = join(gitDir, 'index.nightcode');
            const addResult = await runGitWithEnv(['add', '-A'], {
                GIT_INDEX_FILE: fullTempIndex,
            });
            if (addResult.exitCode !== 0) {
                // If not in a git repo, return null
                return null;
            }

            // Step 3: write tree
            const writeTreeResult = await runGitWithEnv(['write-tree'], {
                GIT_INDEX_FILE: fullTempIndex,
            });
            if (writeTreeResult.exitCode !== 0) {
                try {
                    await unlink(fullTempIndex);
                } catch {}
                return null;
            }
            const treeSha = writeTreeResult.stdout.trim();

            // Clean up temp index
            try {
                await unlink(fullTempIndex);
            } catch {}

            // Step 4: commit tree
            const commitArgs = [
                'commit-tree',
                treeSha,
                '-m',
                `Snapshot ${messageId}`,
            ];
            if (parentSha) {
                commitArgs.push('-p', parentSha);
            }
            const commitResult = await runGitWithEnv(commitArgs, {});
            if (commitResult.exitCode !== 0) {
                return null;
            }
            const commitSha = commitResult.stdout.trim();

            // Step 5: update ref
            await runGitWithEnv(
                [
                    'update-ref',
                    `refs/nightcode/snapshots/${sessionId}`,
                    commitSha,
                ],
                {},
            );

            // Step 6: save to timeline data
            timeline.snapshots[messageId] = {
                commitHash: commitSha,
                messageId,
                parentMessageId,
                timestamp: new Date().toISOString(),
            };
            await this.saveTimeline(sessionId, timeline);

            debug.log(
                'timeline',
                `Created snapshot commit ${commitSha} for message ${messageId}`,
            );
            return commitSha;
        } catch (e) {
            debug.log('timeline', `Error creating snapshot: ${e}`);
            return null;
        }
    }

    async rollbackTo(commitHash: string): Promise<boolean> {
        try {
            // Hard checkout of snapshot commit files into working directory
            const result = await runGitWithEnv(
                ['checkout', commitHash, '--', '.'],
                {},
            );
            return result.exitCode === 0;
        } catch (e) {
            debug.log('timeline', `Error rolling back to ${commitHash}: ${e}`);
            return false;
        }
    }

    async getDiff(commitHash: string): Promise<string> {
        try {
            // Get diff of commit against its parent
            const result = await runGitWithEnv(
                ['show', '--stat', '--patch', commitHash],
                {},
            );
            return result.stdout;
        } catch (e) {
            return `Error loading diff: ${e}`;
        }
    }
}

export const timelineManager = new TimelineManager();
