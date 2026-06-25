import { spawnAgentTool } from './spawn-agent';
import { resolveProviderFallback } from '@/lib/model-utils';
import type { ModeType } from '@nightcode/shared';

interface ParsedPrUrl {
    owner: string;
    repo: string;
    number: number;
}

function parseGitHubPrUrl(url: string): ParsedPrUrl | null {
    // Supports:
    //   https://github.com/owner/repo/pull/123
    //   https://github.com/owner/repo/pull/123/files
    //   https://github.com/owner/repo/pull/123/commits
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;
    return {
        owner: match[1]!,
        repo: match[2]!,
        number: parseInt(match[3]!, 10),
    };
}

async function fetchPrInfo(
    owner: string,
    repo: string,
    prNumber: number,
): Promise<{
    title: string;
    body: string;
    author: string;
    baseBranch: string;
    headBranch: string;
    state: string;
    diff: string;
    files: {
        filename: string;
        status: string;
        additions: number;
        deletions: number;
    }[];
} | null> {
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };

    // Use token if available
    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
        // Fetch PR metadata
        const prResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
            { headers, signal: controller.signal },
        );

        if (!prResponse.ok) {
            return null;
        }

        const prData = (await prResponse.json()) as {
            title: string;
            body: string;
            user: { login: string };
            base: { ref: string };
            head: { ref: string };
            state: string;
        };

        // Fetch changed files
        const filesResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
            { headers, signal: controller.signal },
        );

        const files = filesResponse.ok
            ? ((await filesResponse.json()) as Array<{
                  filename: string;
                  status: string;
                  additions: number;
                  deletions: number;
              }>)
            : [];

        // Fetch the diff
        const diffResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
            {
                headers: {
                    ...headers,
                    Accept: 'application/vnd.github.v3.diff',
                },
                signal: controller.signal,
            },
        );
        const diff = diffResponse.ok ? await diffResponse.text() : '';

        clearTimeout(timer);

        return {
            title: prData.title,
            body: prData.body || '',
            author: prData.user.login,
            baseBranch: prData.base.ref,
            headBranch: prData.head.ref,
            state: prData.state,
            diff,
            files: files.map((f) => ({
                filename: f.filename,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
            })),
        };
    } catch {
        clearTimeout(timer);
        return null;
    }
}

export async function reviewPrTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const { url, focus, model } = input as any;

    // Parse the PR URL
    const parsed = parseGitHubPrUrl(url);
    if (!parsed) {
        return {
            error: 'Invalid GitHub PR URL. Expected format: https://github.com/{owner}/{repo}/pull/{number}',
        };
    }

    // Fetch PR info
    const prInfo = await fetchPrInfo(parsed.owner, parsed.repo, parsed.number);
    if (!prInfo) {
        return {
            error: `Failed to fetch PR #${parsed.number} from ${parsed.owner}/${parsed.repo}. Check the URL and ensure the repository is public or GITHUB_TOKEN is set.`,
        };
    }

    // Build the review task
    const focusNote = focus ? ` Focus especially on: ${focus}.` : '';
    const fileList = prInfo.files
        .map(
            (f) =>
                `- ${f.filename} (${f.status}: +${f.additions}/-${f.deletions})`,
        )
        .join('\n');

    const task = `You are an expert code reviewer. Review the following GitHub Pull Request.

PR #${parsed.number}: ${prInfo.title}
Author: ${prInfo.author}
Branch: ${prInfo.headBranch} → ${prInfo.baseBranch}
State: ${prInfo.state}
${prInfo.body ? `\nDescription:\n${prInfo.body.slice(0, 2000)}\n` : ''}
Changed files (${prInfo.files.length}):
${fileList}
${focusNote}

Below is the full diff for this PR. Review it for:
1. Bugs or logic errors
2. Security issues
3. Performance concerns
4. Code quality / best practices
5. Missing error handling or edge cases
6. Test coverage gaps

Also check for:
- Interface mismatches between changed modules
- Inconsistent patterns across the changes
- Potential breaking changes for downstream consumers

Format each finding as:
- **[CRITICAL]** — bugs, security issues, data loss risks
- **[WARNING]** — performance, maintainability, code quality
- **[INFO]** — style suggestions, minor improvements

For each finding, reference the file and line number from the diff.

End with a summary:
- Overall assessment (approve / request changes / needs discussion)
- Top 3 most important findings
- Suggested next steps

DIFF:
\`\`\`diff
${prInfo.diff.slice(0, 50_000)}
\`\`\`

IMPORTANT: You MUST write your review as text. Do not stop after tool calls.`;

    return spawnAgentTool(
        {
            task,
            model:
                model || resolveProviderFallback(parentModel, 'codeReviewer'),
            mode: 'PLAN',
        },
        parentMode,
        parentModel,
        signal,
        execId,
    );
}
