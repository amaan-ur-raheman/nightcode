import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the command-runner module
vi.mock('../command-runner', () => ({
    runCommand: vi.fn(),
}));

import { runProfiler } from '../performance-profiler';
import { runCommand } from '../command-runner';

const mockRunCommand = vi.mocked(runCommand);

function mockCmdResult(stdout: string, stderr: string, exitCode: number) {
    return {
        exitCode,
        stdout,
        stderr,
        durationMs: 42,
    };
}

describe('runProfiler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns error when no benchmark tool is detected', async () => {
        const result = await runProfiler({ cwd: '/tmp/nonexistent-project' });
        expect(result.success).toBe(false);
        expect(result.benchmarkTool).toBe('none');
        expect(result.benchmarks).toEqual([]);
        expect(result.error).toContain('No benchmark tool detected');
    });

    it('parses vitest verbose checkmark output', async () => {
        const vitestOutput = [
            '   ✓ fibonacci recursive > should be fast (1.23ms)',
            '   ✓ fibonacci iterative > should be fast (0.56ms)',
            '   ✓ fibonacci memoized > should be fast (0.11ms)',
        ].join('\n');
        mockRunCommand.mockResolvedValueOnce(
            mockCmdResult(vitestOutput, '', 0),
        );

        const result = await runProfiler({ command: 'npx vitest bench' });

        expect(result.success).toBe(true);
        expect(result.benchmarkTool).toBe('custom');
        expect(result.benchmarks.length).toBe(3);
        expect(result.benchmarks[0]!.name).toBe('fibonacci recursive');
        expect(result.benchmarks[0]!.opsPerSec).toBeGreaterThan(0);
    });

    it('parses vitest table format output', async () => {
        const vitestOutput = [
            '  fibonacci recursive  812.34 ops/s',
            '  fibonacci iterative  1785.71 ops/s',
        ].join('\n');
        mockRunCommand.mockResolvedValueOnce(
            mockCmdResult(vitestOutput, '', 0),
        );

        const result = await runProfiler({ command: 'npx vitest bench' });

        expect(result.benchmarks.length).toBe(2);
        expect(result.benchmarks[0]!.name).toBe('fibonacci recursive');
        expect(result.benchmarks[0]!.opsPerSec).toBe(812.34);
    });

    it('parses cargo bench output', async () => {
        const cargoOutput = [
            'test bench_fibonacci ... bench:    1,234,567 ns/iter (+/- 12,345)',
            'test bench_hash    ... bench:      456,789 ns/iter (+/- 4,567)',
            'test bench_sort    ... bench:    2,345,678 ns/iter (+/- 23,456)',
        ].join('\n');
        mockRunCommand.mockResolvedValueOnce(mockCmdResult(cargoOutput, '', 0));

        const result = await runProfiler({ command: 'cargo bench' });

        expect(result.success).toBe(true);
        expect(result.benchmarks.length).toBe(3);
        // bench_hash has lowest ns/iter → highest ops/sec → rank 1
        const byRank = [...result.benchmarks].sort(
            (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
        );
        expect(byRank[0]!.name).toBe('bench_hash');
        expect(byRank[0]!.opsPerSec).toBeGreaterThan(byRank[1]!.opsPerSec!);
    });

    it('identifies hotspots correctly', async () => {
        const cargoOutput = [
            'test bench_fast ... bench:      100,000 ns/iter',
            'test bench_slow ... bench:   10,000,000 ns/iter',
            'test bench_medium ... bench:   1,000,000 ns/iter',
        ].join('\n');
        mockRunCommand.mockResolvedValueOnce(mockCmdResult(cargoOutput, '', 0));

        const result = await runProfiler({ command: 'cargo bench' });

        expect(result.hotspots.length).toBe(3);
        // Hotspots sorted by ops/sec ascending (slowest first)
        expect(result.hotspots[0]!.name).toBe('bench_slow');
        expect(result.hotspots[1]!.name).toBe('bench_medium');
        expect(result.hotspots[2]!.name).toBe('bench_fast');
    });

    it('handles benchmark command failure', async () => {
        mockRunCommand.mockResolvedValueOnce(
            mockCmdResult('', 'error: compilation failed', 1),
        );

        const result = await runProfiler({ command: 'cargo bench' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Exit code 1');
    });

    it('parses go bench output', async () => {
        const goOutput = [
            'BenchmarkFibonacci-8      1234567    987 ns/op    128 B/op    2 allocs/op',
            'BenchmarkHash-8           2345678    456 ns/op     64 B/op    1 allocs/op',
        ].join('\n');
        mockRunCommand.mockResolvedValueOnce(mockCmdResult(goOutput, '', 0));

        const result = await runProfiler({ command: 'go test -bench=.' });

        expect(result.success).toBe(true);
        expect(result.benchmarks.length).toBe(2);
        expect(result.benchmarks[0]!.name).toBe('Fibonacci');
        expect(result.benchmarks[0]!.samples).toBe(1234567);
    });

    it('includes summary with hotspot info', async () => {
        const cargoOutput = [
            'test bench_a ... bench:      100,000 ns/iter',
            'test bench_b ... bench:   10,000,000 ns/iter',
        ].join('\n');
        mockRunCommand.mockResolvedValueOnce(mockCmdResult(cargoOutput, '', 0));

        const result = await runProfiler({ command: 'cargo bench' });

        expect(result.summary).toContain('Benchmark tool');
        expect(result.summary).toContain('Hotspots');
        expect(result.summary).toContain('bench_b');
    });

    it('applies filter to command args', async () => {
        mockRunCommand.mockResolvedValueOnce(mockCmdResult('', '', 0));

        await runProfiler({ command: 'npx vitest bench', filter: 'fibonacci' });

        const callArgs = mockRunCommand.mock.calls[0]!;
        // args is the second parameter
        expect(callArgs[1]).toContain('fibonacci');
    });

    it('assigns ranks correctly', async () => {
        const cargoOutput = [
            'test bench_3rd ... bench:    3,000,000 ns/iter',
            'test bench_1st ... bench:      500,000 ns/iter',
            'test bench_2nd ... bench:    1,500,000 ns/iter',
        ].join('\n');
        mockRunCommand.mockResolvedValueOnce(mockCmdResult(cargoOutput, '', 0));

        const result = await runProfiler({ command: 'cargo bench' });

        // Ranks: 1st = highest ops/sec, 3rd = lowest
        const sorted = [...result.benchmarks].sort(
            (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
        );
        expect(sorted.length).toBe(3);
        expect(sorted[0]!.name).toBe('bench_1st');
        expect(sorted[1]!.name).toBe('bench_2nd');
        expect(sorted[2]!.name).toBe('bench_3rd');
    });

    it('returns raw output for debugging', async () => {
        const rawOutput = 'some raw benchmark output\nmore lines';
        mockRunCommand.mockResolvedValueOnce(mockCmdResult(rawOutput, '', 0));

        const result = await runProfiler({ command: 'custom-bench' });

        expect(result.rawOutput).toContain('some raw benchmark output');
    });
});
