import { toolInputSchemas } from '@nightcode/shared';
import { runProfiler } from '@/lib/performance-profiler';

export async function profileCodeTool(input: unknown) {
    const { filter, command } = toolInputSchemas.profileCode.parse(input);

    const report = await runProfiler({
        filter: filter ?? undefined,
        command: command ?? undefined,
    });

    return {
        success: report.success,
        benchmarkTool: report.benchmarkTool,
        command: report.command,
        durationMs: report.durationMs,
        totalBenchmarks: report.benchmarks.length,
        summary: report.summary,
        hotspots: report.hotspots.map((h) => ({
            name: h.name,
            opsPerSec: h.opsPerSec,
            avgTimeNs: h.avgTimeNs,
            margin: h.margin,
            rank: h.rank,
        })),
        topPerformers: [...report.benchmarks]
            .sort((a, b) => (b.opsPerSec ?? 0) - (a.opsPerSec ?? 0))
            .slice(0, 10)
            .map((b) => ({
                name: b.name,
                opsPerSec: b.opsPerSec,
                avgTimeNs: b.avgTimeNs,
                margin: b.margin,
                rank: b.rank,
            })),
        error: report.error,
    };
}
