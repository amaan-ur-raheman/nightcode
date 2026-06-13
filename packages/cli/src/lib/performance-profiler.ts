import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { debug } from './debug';
import { runCommand } from './command-runner';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
    name: string;
    /** Operations per second (or iterations/sec) */
    opsPerSec?: number;
    /** Average time per operation in nanoseconds */
    avgTimeNs?: number;
    /** Margin of error percentage */
    margin?: number;
    /** Number of samples */
    samples?: number;
    /** Rank among all benchmarks (1 = fastest) */
    rank?: number;
}

export interface ProfileReport {
    timestamp: number;
    benchmarkTool: string;
    /** The command that was run */
    command: string;
    /** Total wall-clock time in ms */
    durationMs: number;
    /** Whether the benchmark run succeeded */
    success: boolean;
    /** Parsed benchmark results, sorted by ops/sec descending */
    benchmarks: BenchmarkResult[];
    /** Summary text for display */
    summary: string;
    /** Hotspot: top 3 slowest benchmarks */
    hotspots: BenchmarkResult[];
    /** Raw output from the benchmark tool */
    rawOutput: string;
    /** Error message if the run failed */
    error?: string;
}

// ─── Benchmark tool detection ──────────────────────────────────────────────

interface BenchmarkTool {
    name: string;
    command: string;
    args: string[];
    /** Timeout in ms */
    timeoutMs: number;
}

function detectBenchmarkTool(cwd: string): BenchmarkTool | null {
    // Node.js / TypeScript — check for vitest bench
    const pkgJsonPath = resolve(cwd, 'package.json');
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

            // Check for vitest bench support
            if ('vitest' in allDeps) {
                // Check if any bench files exist
                if (
                    existsSync(resolve(cwd, 'vitest.config.ts')) ||
                    existsSync(resolve(cwd, 'vitest.config.mts'))
                ) {
                    return {
                        name: 'vitest-bench',
                        command: 'npx',
                        args: ['vitest', 'bench', '--reporter=verbose'],
                        timeoutMs: 300_000, // 5 min for benchmarks
                    };
                }
                // Still try vitest bench even without config — it may have bench files
                return {
                    name: 'vitest-bench',
                    command: 'npx',
                    args: ['vitest', 'bench', '--reporter=verbose'],
                    timeoutMs: 300_000,
                };
            }

            // Check for jest with benchmark
            if ('jest' in allDeps) {
                return {
                    name: 'jest-bench',
                    command: 'npx',
                    args: ['jest', '--verbose'],
                    timeoutMs: 300_000,
                };
            }

            // Check for tinybench or benchmark.js
            if ('tinybench' in allDeps || 'benchmark' in allDeps) {
                return {
                    name: 'custom-bench',
                    command: 'bun',
                    args: ['run', 'bench'],
                    timeoutMs: 300_000,
                };
            }

            // Check package.json scripts for bench command
            if (pkg.scripts?.bench) {
                return {
                    name: 'npm-bench',
                    command: 'npm',
                    args: ['run', 'bench'],
                    timeoutMs: 300_000,
                };
            }
        } catch {
            /* malformed package.json */
        }
    }

    // Rust — cargo bench
    if (existsSync(resolve(cwd, 'Cargo.toml'))) {
        return {
            name: 'cargo-bench',
            command: 'cargo',
            args: ['bench', '--message-format=short'],
            timeoutMs: 600_000, // 10 min for Rust benchmarks
        };
    }

    // Go — go test -bench
    if (existsSync(resolve(cwd, 'go.mod'))) {
        return {
            name: 'go-bench',
            command: 'go',
            args: ['test', '-bench=.', '-benchmem', './...'],
            timeoutMs: 600_000,
        };
    }

    // Python — pytest benchmark
    if (
        existsSync(resolve(cwd, 'pyproject.toml')) ||
        existsSync(resolve(cwd, 'requirements.txt'))
    ) {
        return {
            name: 'pytest-bench',
            command: 'python',
            args: ['-m', 'pytest', '--benchmark-only', '-v'],
            timeoutMs: 300_000,
        };
    }

    return null;
}

// ─── Output parsers ─────────────────────────────────────────────────────────

function parseVitestBenchOutput(output: string): BenchmarkResult[] {
    const benchmarks: BenchmarkResult[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
        // Format 1: "  name  1234.56  ops/s" — vitest table output
        const benchMatch = line.match(
            /^\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+ops\/s/i,
        );
        if (benchMatch) {
            const name = benchMatch[1]!;
            const opsPerSec = parseFloat(benchMatch[2]!.replace(/,/g, ''));
            if (!isNaN(opsPerSec) && opsPerSec > 0) {
                benchmarks.push({
                    name,
                    opsPerSec,
                    avgTimeNs: 1_000_000_000 / opsPerSec,
                });
            }
            continue;
        }

        // Format 2: Vitest verbose check marks — "   ✓ name > test (Xms)"
        const verboseMatch = line.match(
            /[✓✔✅]\s+(.+?)\s*[>→].*?\((\d+(?:\.\d+)?)ms\)/,
        );
        if (verboseMatch) {
            const name = verboseMatch[1]!;
            const timeMs = parseFloat(verboseMatch[2]!);
            if (!isNaN(timeMs) && timeMs > 0) {
                const avgTimeNs = timeMs * 1_000_000;
                benchmarks.push({
                    name,
                    opsPerSec: 1_000_000_000 / avgTimeNs,
                    avgTimeNs,
                });
            }
            continue;
        }

        // Margin: "  Name    ±0.12%"
        const marginMatch = line.match(/^\s+(\S+)\s+.*?±([\d.]+)%/);
        if (marginMatch) {
            const name = marginMatch[1]!;
            const margin = parseFloat(marginMatch[2]!);
            const existing = benchmarks.find((b) => b.name === name);
            if (existing) {
                existing.margin = margin;
            }
        }
    }

    return benchmarks;
}

function parseCargoBenchOutput(output: string): BenchmarkResult[] {
    const benchmarks: BenchmarkResult[] = [];
    const lines = output.split('\n');

    // Cargo bench output format:
    // "test bench_fibonacci ... bench:    1,234,567 ns/iter (+/- 12,345)"
    // "test bench_hash    ... bench:      456,789 ns/iter (+/- 4,567)"
    for (const line of lines) {
        const benchMatch = line.match(
            /^test\s+(\S+)\s+\.\.\.\s+bench:\s+([\d,]+)\s+ns\/iter(?:\s+\(\+\/-\s+([\d,]+)\))?/,
        );
        if (benchMatch) {
            const name = benchMatch[1]!;
            const avgTimeNs = parseInt(benchMatch[2]!.replace(/,/g, ''), 10);
            const margin = benchMatch[3]
                ? parseInt(benchMatch[3]!.replace(/,/g, ''), 10)
                : undefined;

            if (!isNaN(avgTimeNs) && avgTimeNs > 0) {
                benchmarks.push({
                    name,
                    opsPerSec: 1_000_000_000 / avgTimeNs,
                    avgTimeNs,
                    margin: margin ? (margin / avgTimeNs) * 100 : undefined,
                });
            }
        }
    }

    return benchmarks;
}

function parseGoBenchOutput(output: string): BenchmarkResult[] {
    const benchmarks: BenchmarkResult[] = [];
    const lines = output.split('\n');

    // Go bench output format:
    // "BenchmarkFibonacci-8      1234567    987 ns/op    128 B/op    2 allocs/op"
    for (const line of lines) {
        const benchMatch = line.match(
            /^Benchmark(\w+)[-\d]*\s+(\d+)\s+(\d+)\s+ns\/op/,
        );
        if (benchMatch) {
            const name = benchMatch[1]!;
            const samples = parseInt(benchMatch[2]!, 10);
            const avgTimeNs = parseInt(benchMatch[3]!, 10);

            if (!isNaN(avgTimeNs) && avgTimeNs > 0) {
                benchmarks.push({
                    name,
                    opsPerSec: 1_000_000_000 / avgTimeNs,
                    avgTimeNs,
                    samples,
                });
            }
        }
    }

    return benchmarks;
}

function parsePytestBenchOutput(output: string): BenchmarkResult[] {
    const benchmarks: BenchmarkResult[] = [];
    const lines = output.split('\n');

    // pytest-benchmark output format:
    // "test_fibonacci     1234.56 us  ±  12.34 us  7 rounds  ..."
    // "test_hash          456.78 us  ±   4.56 us  7 rounds"
    for (const line of lines) {
        const benchMatch = line.match(
            /^(\S+)\s+([\d.]+)\s+(us|ms|s)\s+±\s+([\d.]+)\s+(us|ms|s)/,
        );
        if (benchMatch) {
            const name = benchMatch[1]!;
            const value = parseFloat(benchMatch[2]!);
            const unit = benchMatch[3]!;
            const marginValue = parseFloat(benchMatch[4]!);
            const marginUnit = benchMatch[5]!;

            let avgTimeNs: number;
            if (unit === 'us') avgTimeNs = value * 1_000;
            else if (unit === 'ms') avgTimeNs = value * 1_000_000;
            else avgTimeNs = value * 1_000_000_000;

            let marginNs: number;
            if (marginUnit === 'us') marginNs = marginValue * 1_000;
            else if (marginUnit === 'ms') marginNs = marginValue * 1_000_000;
            else marginNs = marginValue * 1_000_000_000;

            if (!isNaN(avgTimeNs) && avgTimeNs > 0) {
                benchmarks.push({
                    name,
                    opsPerSec: 1_000_000_000 / avgTimeNs,
                    avgTimeNs,
                    margin: (marginNs / avgTimeNs) * 100,
                });
            }
        }
    }

    return benchmarks;
}

function autoDetectFormat(output: string): BenchmarkResult[] {
    // Try each parser and return the first that produces results
    const parsers = [
        parseCargoBenchOutput,
        parseGoBenchOutput,
        parsePytestBenchOutput,
        parseVitestBenchOutput,
    ];
    for (const parser of parsers) {
        const results = parser(output);
        if (results.length > 0) return results;
    }
    return [];
}

function parseBenchmarkOutput(
    toolName: string,
    output: string,
): BenchmarkResult[] {
    switch (toolName) {
        case 'vitest-bench':
        case 'jest-bench':
        case 'custom-bench':
        case 'npm-bench':
            return parseVitestBenchOutput(output);
        case 'cargo-bench':
            return parseCargoBenchOutput(output);
        case 'go-bench':
            return parseGoBenchOutput(output);
        case 'pytest-bench':
            return parsePytestBenchOutput(output);
        case 'custom':
        default:
            return autoDetectFormat(output);
    }
}

// ─── Hotspot analysis ──────────────────────────────────────────────────────

function identifyHotspots(benchmarks: BenchmarkResult[]): BenchmarkResult[] {
    // Sort by ops/sec ascending (slowest first)
    const sorted = [...benchmarks].sort(
        (a, b) => (a.opsPerSec ?? 0) - (b.opsPerSec ?? 0),
    );
    return sorted.slice(0, 3);
}

function formatDuration(ns: number): string {
    if (ns < 1_000) return `${ns.toFixed(0)} ns`;
    if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
    if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
    return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function formatSummary(
    toolName: string,
    benchmarks: BenchmarkResult[],
    hotspots: BenchmarkResult[],
    durationMs: number,
): string {
    const parts: string[] = [];
    parts.push(`🔧 Benchmark tool: ${toolName}`);
    parts.push(`⏱  Total time: ${(durationMs / 1000).toFixed(1)}s`);
    parts.push(`📊 Benchmarks found: ${benchmarks.length}`);
    parts.push('');

    if (benchmarks.length > 0) {
        parts.push('📈 Top performers (by ops/sec):');
        const top3 = [...benchmarks]
            .sort((a, b) => (b.opsPerSec ?? 0) - (a.opsPerSec ?? 0))
            .slice(0, 3);
        for (const b of top3) {
            const marginStr =
                b.margin !== undefined ? ` (±${b.margin.toFixed(1)}%)` : '';
            parts.push(
                `  🥇 ${b.name}: ${(b.opsPerSec ?? 0).toLocaleString()} ops/s${marginStr}`,
            );
        }
    }

    if (hotspots.length > 0) {
        parts.push('');
        parts.push('🔥 Hotspots (slowest benchmarks):');
        for (let i = 0; i < hotspots.length; i++) {
            const b = hotspots[i]!;
            const icon = i === 0 ? '🟥' : i === 1 ? '🟧' : '🟨';
            parts.push(
                `  ${icon} ${b.name}: ${formatDuration(b.avgTimeNs ?? 0)}/iter`,
            );
        }
    }

    return parts.join('\n');
}

// ─── Main profiler API ─────────────────────────────────────────────────────

export interface ProfileOptions {
    /** Specific benchmark file or pattern to run */
    filter?: string;
    /** Custom benchmark command to run instead of auto-detecting */
    command?: string;
    /** Working directory */
    cwd?: string;
}

export async function runProfiler(
    options: ProfileOptions = {},
): Promise<ProfileReport> {
    const cwd = options.cwd ?? process.cwd();
    const startTime = Date.now();

    let tool: BenchmarkTool;

    if (options.command) {
        // Custom command — split on spaces
        const parts = options.command.split(/\s+/);
        tool = {
            name: 'custom',
            command: parts[0]!,
            args: parts.slice(1),
            timeoutMs: 600_000,
        };
    } else {
        const detected = detectBenchmarkTool(cwd);
        if (!detected) {
            return {
                timestamp: Date.now(),
                benchmarkTool: 'none',
                command: '',
                durationMs: 0,
                success: false,
                benchmarks: [],
                summary:
                    'No benchmark tool detected. Install vitest, cargo, go test, or pytest-benchmark.',
                hotspots: [],
                rawOutput: '',
                error: 'No benchmark tool detected for this project type.',
            };
        }
        tool = detected;
    }

    // Apply filter if provided
    const args = [...tool.args];
    if (options.filter) {
        if (tool.name === 'go-bench') {
            args.push(`-run=${options.filter}`);
        } else {
            args.push(options.filter);
        }
    }

    const command = `${tool.command} ${args.join(' ')}`;
    debug.log('profiler', `Running: ${command}`);

    const result = await runCommand(tool.command, args, cwd, tool.timeoutMs);
    const rawOutput = (result.stdout + result.stderr).slice(0, 50_000);

    const benchmarks = parseBenchmarkOutput(tool.name, rawOutput);
    const hotspots = identifyHotspots(benchmarks);

    // Assign ranks
    const sorted = [...benchmarks].sort(
        (a, b) => (b.opsPerSec ?? 0) - (a.opsPerSec ?? 0),
    );
    for (let i = 0; i < sorted.length; i++) {
        sorted[i]!.rank = i + 1;
    }

    const durationMs = Date.now() - startTime;
    const summary = formatSummary(tool.name, benchmarks, hotspots, durationMs);

    return {
        timestamp: Date.now(),
        benchmarkTool: tool.name,
        command,
        durationMs,
        success: result.exitCode === 0,
        benchmarks,
        summary,
        hotspots,
        rawOutput,
        error:
            result.exitCode !== 0 ? `Exit code ${result.exitCode}` : undefined,
    };
}
