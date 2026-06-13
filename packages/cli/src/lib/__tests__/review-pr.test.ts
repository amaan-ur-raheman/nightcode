import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock spawnAgentTool to capture the task
vi.mock('../tools/spawn-agent', () => ({
    spawnAgentTool: vi.fn(async (input: unknown) => ({
        __mock: true,
        task: (input as { task: string }).task,
        mode: (input as { mode: string }).mode,
    })),
}));

// Mock resolveProviderFallback
vi.mock('@/lib/model-utils', () => ({
    resolveProviderFallback: vi.fn(() => 'fallback-model'),
}));

import { reviewPrTool } from '../tools/review-pr';
import { spawnAgentTool } from '../tools/spawn-agent';

const mockedSpawnAgent = vi.mocked(spawnAgentTool);

describe('reviewPrTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
    });

    it('returns error for invalid PR URL', async () => {
        const result = await reviewPrTool(
            {
                url: 'https://example.com/not-a-pr',
                focus: undefined,
                model: undefined,
            },
            'PLAN',
            undefined,
            undefined,
            undefined,
        );

        expect(result).toEqual({
            error: 'Invalid GitHub PR URL. Expected format: https://github.com/{owner}/{repo}/pull/{number}',
        });
    });

    it('parses valid GitHub PR URLs correctly', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                title: 'Fix auth bug',
                body: 'Fixes a critical auth issue',
                user: { login: 'octocat' },
                base: { ref: 'main' },
                head: { ref: 'fix/auth' },
                state: 'open',
            }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [
                {
                    filename: 'src/auth.ts',
                    status: 'modified',
                    additions: 10,
                    deletions: 5,
                },
            ],
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () =>
                '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new',
        });

        await reviewPrTool(
            {
                url: 'https://github.com/owner/repo/pull/42',
                focus: 'security',
                model: undefined,
            },
            'PLAN',
            'claude-3-5-sonnet',
            undefined,
            undefined,
        );

        expect(mockedSpawnAgent).toHaveBeenCalledTimes(1);

        const spawnCall = mockedSpawnAgent.mock.calls[0]?.[0] as {
            task: string;
            mode: string;
        };

        expect(spawnCall.task).toContain('PR #42');
        expect(spawnCall.task).toContain('Fix auth bug');
        expect(spawnCall.task).toContain('octocat');
        expect(spawnCall.task).toContain('src/auth.ts');
        expect(spawnCall.task).toContain('Focus especially on: security');
        expect(spawnCall.mode).toBe('PLAN');
    });

    it('returns error when GitHub API fails', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

        const result = await reviewPrTool(
            {
                url: 'https://github.com/private/repo/pull/1',
                focus: undefined,
                model: undefined,
            },
            'PLAN',
            undefined,
            undefined,
            undefined,
        );

        expect(result).toEqual({
            error: expect.stringContaining('Failed to fetch PR'),
        });
    });

    it('handles network errors gracefully', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await reviewPrTool(
            {
                url: 'https://github.com/owner/repo/pull/99',
                focus: undefined,
                model: undefined,
            },
            'PLAN',
            undefined,
            undefined,
            undefined,
        );

        expect(result).toEqual({
            error: expect.stringContaining('Failed to fetch PR'),
        });
    });

    it('accepts various valid PR URL formats', async () => {
        const urls = [
            'https://github.com/owner/repo/pull/123',
            'https://github.com/owner/repo/pull/123/files',
            'https://github.com/owner/repo/pull/123/commits',
        ];

        for (const url of urls) {
            vi.clearAllMocks();
            mockFetch.mockReset();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    title: 'Test',
                    body: '',
                    user: { login: 'user' },
                    base: { ref: 'main' },
                    head: { ref: 'head' },
                    state: 'open',
                }),
            });
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
            mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '' });

            await reviewPrTool(
                { url, focus: undefined, model: 'test-model' },
                'PLAN',
                undefined,
                undefined,
                undefined,
            );

            expect(mockedSpawnAgent).toHaveBeenCalled();
        }
    });

    it('truncates large diffs', async () => {
        const largeDiff = 'line\n'.repeat(20_000);

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                title: 'Large PR',
                body: '',
                user: { login: 'user' },
                base: { ref: 'main' },
                head: { ref: 'feature' },
                state: 'open',
            }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => largeDiff,
        });

        await reviewPrTool(
            {
                url: 'https://github.com/owner/repo/pull/1',
                focus: undefined,
                model: undefined,
            },
            'PLAN',
            undefined,
            undefined,
            undefined,
        );

        const spawnCall = mockedSpawnAgent.mock.calls[0]?.[0] as {
            task: string;
        };
        expect(spawnCall.task.length).toBeLessThan(largeDiff.length + 1000);
    });

    it('uses focus parameter when provided', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                title: 'PR',
                body: '',
                user: { login: 'user' },
                base: { ref: 'main' },
                head: { ref: 'head' },
                state: 'open',
            }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '' });

        await reviewPrTool(
            {
                url: 'https://github.com/owner/repo/pull/1',
                focus: 'performance',
                model: undefined,
            },
            'PLAN',
            undefined,
            undefined,
            undefined,
        );

        const spawnCall = mockedSpawnAgent.mock.calls[0]?.[0] as {
            task: string;
        };
        expect(spawnCall.task).toContain('Focus especially on: performance');
    });

    it('uses specified model when provided', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                title: 'PR',
                body: '',
                user: { login: 'user' },
                base: { ref: 'main' },
                head: { ref: 'head' },
                state: 'open',
            }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '' });

        await reviewPrTool(
            {
                url: 'https://github.com/owner/repo/pull/1',
                focus: undefined,
                model: 'custom-model',
            },
            'PLAN',
            undefined,
            undefined,
            undefined,
        );

        const spawnCall = mockedSpawnAgent.mock.calls[0]?.[0] as {
            model: string;
        };
        expect(spawnCall.model).toBe('custom-model');
    });

    it('includes file change statistics in review task', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                title: 'Add feature',
                body: '',
                user: { login: 'dev' },
                base: { ref: 'main' },
                head: { ref: 'feat' },
                state: 'open',
            }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [
                {
                    filename: 'src/a.ts',
                    status: 'modified',
                    additions: 50,
                    deletions: 10,
                },
                {
                    filename: 'src/b.ts',
                    status: 'added',
                    additions: 100,
                    deletions: 0,
                },
                {
                    filename: 'src/c.ts',
                    status: 'removed',
                    additions: 0,
                    deletions: 75,
                },
            ],
        });
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '' });

        await reviewPrTool(
            {
                url: 'https://github.com/owner/repo/pull/5',
                focus: undefined,
                model: undefined,
            },
            'PLAN',
            undefined,
            undefined,
            undefined,
        );

        const spawnCall = mockedSpawnAgent.mock.calls[0]?.[0] as {
            task: string;
        };
        expect(spawnCall.task).toContain('+50/-10');
        expect(spawnCall.task).toContain('+100/-0');
        expect(spawnCall.task).toContain('+0/-75');
        expect(spawnCall.task).toContain('3');
    });
});
