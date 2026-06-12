import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

describe('ToolAnalytics', () => {
    const ANALYTICS_FILE = join(
        homedir(),
        '.nightcode',
        'analytics',
        'tool-usage.json',
    );

    beforeEach(async () => {
        try {
            unlinkSync(ANALYTICS_FILE);
        } catch {}
        const { toolAnalytics } = await import('../tool-analytics');
        toolAnalytics.reset();
    });

    afterEach(() => {
        try {
            unlinkSync(ANALYTICS_FILE);
        } catch {}
    });

    it('starts with zero stats', async () => {
        const { toolAnalytics } = await import('../tool-analytics');
        const stats = await toolAnalytics.getStats();
        expect(stats.totalCalls).toBe(0);
        expect(stats.topTools).toEqual([]);
    });

    it('records tool calls and retrieves stats', async () => {
        const { toolAnalytics } = await import('../tool-analytics');
        await toolAnalytics.recordToolCall('readFile', 100, true);
        await toolAnalytics.recordToolCall('bash', 500, true);
        await toolAnalytics.recordToolCall('readFile', 200, true);
        const stats = await toolAnalytics.getStats();
        expect(stats.totalCalls).toBe(3);
        expect(stats.topTools).toHaveLength(2);
        expect(stats.topTools[0]!.tool).toBe('readFile');
        expect(stats.topTools[0]!.count).toBe(2);
        expect(stats.topTools[1]!.tool).toBe('bash');
    });

    it('tracks error counts', async () => {
        const { toolAnalytics } = await import('../tool-analytics');
        await toolAnalytics.recordToolCall('bash', 100, false);
        const stats = await toolAnalytics.getStats();
        expect(stats.topTools[0]!.errorRate).toBe(100);
    });

    it('clears stats', async () => {
        const { toolAnalytics } = await import('../tool-analytics');
        await toolAnalytics.recordToolCall('readFile', 100, true);
        await toolAnalytics.clearStats();
        const stats = await toolAnalytics.getStats();
        expect(stats.totalCalls).toBe(0);
    });

    it('calculates average tool time', async () => {
        const { toolAnalytics } = await import('../tool-analytics');
        await toolAnalytics.recordToolCall('bash', 100, true);
        await toolAnalytics.recordToolCall('bash', 300, true);
        const stats = await toolAnalytics.getStats();
        expect(stats.topTools[0]!.avgTime).toBe(200); // (100 + 300) / 2
    });
});
