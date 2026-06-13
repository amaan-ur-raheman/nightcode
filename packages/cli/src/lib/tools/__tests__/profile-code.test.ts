import { describe, it, expect, vi } from 'vitest';
import { profileCodeTool } from '../profile-code';
import { runProfiler } from '@/lib/performance-profiler';

vi.mock('@/lib/performance-profiler', () => ({
    runProfiler: vi.fn(),
}));

describe('profileCodeTool', () => {
    it('should profile code and return top performers without mutating original benchmarks array', async () => {
        const benchmarks = [
            {
                name: 'b1',
                opsPerSec: 100,
                avgTimeNs: 10000000,
                margin: 1.0,
                rank: 2,
            },
            {
                name: 'b2',
                opsPerSec: 200,
                avgTimeNs: 5000000,
                margin: 0.5,
                rank: 1,
            },
            {
                name: 'b3',
                opsPerSec: 50,
                avgTimeNs: 20000000,
                margin: 2.0,
                rank: 3,
            },
        ];

        const originalBenchmarksCopy = [...benchmarks];

        const mockReport = {
            success: true,
            benchmarkTool: 'vitest',
            command: 'vitest run',
            durationMs: 120,
            summary: 'all good',
            hotspots: [],
            benchmarks: benchmarks,
            error: null,
        };

        vi.mocked(runProfiler).mockResolvedValue(mockReport as any);

        const result = await profileCodeTool({ filter: 'test' });

        expect(result.success).toBe(true);
        expect(result.topPerformers[0]!.name).toBe('b2'); // highest opsPerSec
        expect(result.topPerformers[1]!.name).toBe('b1');
        expect(result.topPerformers[2]!.name).toBe('b3'); // lowest opsPerSec

        // Verify original benchmarks array remains unchanged (not sorted in place)
        expect(benchmarks).toEqual(originalBenchmarksCopy);
    });
});
