import { existsSync, readFileSync } from 'fs';
import { resolve, extname, relative } from 'path';
import { debug } from './debug';
import { runCommand } from './command-runner';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CheckResult {
    checkType: 'typecheck' | 'lint' | 'test';
    success: boolean;
    exitCode: number;
    output: string;
    errors: CheckError[];
    durationMs: number;
}

export interface CheckError {
    file?: string;
    line?: number;
    column?: number;
    message: string;
    rule?: string;
    severity: 'error' | 'warning';
}

export interface ValidationReport {
    timestamp: number;
    filesChecked: string[];
    results: CheckResult[];
    success: boolean;
    summary: string;
    autoFixAttempted: boolean;
    autoFixResult?: AutoFixResult;
}

export interface AutoFixResult {
    success: boolean;
    fixedCount: number;
    remainingErrors: number;
    output: string;
}

export interface PipelineConfig {
    enabled: boolean;
    typecheckEnabled: boolean;
    lintEnabled: boolean;
    testEnabled: boolean;
    autoFixEnabled: boolean;
    debounceMs: number;
    maxOutputLength: number;
}

// ─── File type detection ────────────────────────────────────────────────────

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mtsx']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.mjsx']);
const PY_EXTENSIONS = new Set(['.py']);
const RUST_EXTENSIONS = new Set(['.rs']);
const GO_EXTENSIONS = new Set(['.go']);
const SOURCE_EXTENSIONS = new Set([
    ...TS_EXTENSIONS,
    ...JS_EXTENSIONS,
    ...PY_EXTENSIONS,
    ...RUST_EXTENSIONS,
    ...GO_EXTENSIONS,
]);

function getSourceExtension(filePath: string): string {
    return extname(filePath).toLowerCase();
}

function isSourceFile(filePath: string): boolean {
    return SOURCE_EXTENSIONS.has(getSourceExtension(filePath));
}

// ─── Check detection ────────────────────────────────────────────────────────

export type CheckType = 'typecheck' | 'lint' | 'test';

interface ProjectType {
    type: 'node' | 'python' | 'rust' | 'go' | 'unknown';
    hasTypecheck: boolean;
    hasLint: boolean;
    hasTest: boolean;
}

function detectProjectType(cwd: string): ProjectType {
    const result: ProjectType = {
        type: 'unknown',
        hasTypecheck: false,
        hasLint: false,
        hasTest: false,
    };

    // Node.js / TypeScript
    const pkgJsonPath = resolve(cwd, 'package.json');
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

            result.type = 'node';

            // Typecheck
            if ('typescript' in allDeps || 'ts-node' in allDeps) {
                result.hasTypecheck = true;
            }

            // Lint
            if ('eslint' in allDeps || 'biome' in allDeps) {
                result.hasLint = true;
            }

            // Test
            if (
                'vitest' in allDeps ||
                'jest' in allDeps ||
                'mocha' in allDeps
            ) {
                result.hasTest = true;
            }
        } catch {
            /* malformed package.json */
        }
    }

    // Python
    if (
        existsSync(resolve(cwd, 'pyproject.toml')) ||
        existsSync(resolve(cwd, 'setup.py')) ||
        existsSync(resolve(cwd, 'requirements.txt'))
    ) {
        result.type = 'python';
        result.hasLint =
            existsSync(resolve(cwd, '.flake8')) ||
            existsSync(resolve(cwd, 'pyproject.toml'));
        result.hasTest =
            existsSync(resolve(cwd, 'pytest.ini')) ||
            existsSync(resolve(cwd, 'conftest.py'));
        result.hasTypecheck =
            existsSync(resolve(cwd, 'mypy.ini')) ||
            existsSync(resolve(cwd, 'py.typed'));
    }

    // Rust
    if (existsSync(resolve(cwd, 'Cargo.toml'))) {
        result.type = 'rust';
        result.hasTypecheck = true; // rustc is always available
        result.hasTest = true; // cargo test is always available
        result.hasLint = existsSync(resolve(cwd, '.clippy.toml'));
    }

    // Go
    if (existsSync(resolve(cwd, 'go.mod'))) {
        result.type = 'go';
        result.hasTypecheck = true; // go vet is always available
        result.hasTest = true; // go test is always available
        result.hasLint = existsSync(resolve(cwd, '.golangci.yml'));
    }

    return result;
}

function detectMonorepoPackage(cwd: string, filePath: string): string | null {
    const rel = relative(cwd, filePath);
    // Check if file is in a packages/ directory (monorepo pattern)
    const match = rel.match(/^packages\/([^/]+)\//);
    if (match?.[1]) return match[1];
    return null;
}

// ─── Check runners ──────────────────────────────────────────────────────────

async function runTypecheck(
    cwd: string,
    project: ProjectType,
    changedFiles: string[],
): Promise<CheckResult> {
    const startTime = Date.now();
    const projectType = project.type;

    try {
        let cmd: string;
        let args: string[];

        if (projectType === 'node') {
            // Try tsc first, fall back to npx
            cmd = 'npx';
            args = ['tsc', '--noEmit', '--pretty', 'false'];

            // If in a monorepo, try to run scoped typecheck
            const monorepoPkg = detectMonorepoPackage(
                cwd,
                changedFiles[0] ?? '',
            );
            if (monorepoPkg) {
                // Try package-specific typecheck
                const pkgJsonPath = resolve(
                    cwd,
                    'packages',
                    monorepoPkg,
                    'package.json',
                );
                if (existsSync(pkgJsonPath)) {
                    try {
                        const pkgJson = JSON.parse(
                            readFileSync(pkgJsonPath, 'utf-8'),
                        );
                        if (pkgJson.scripts?.typecheck) {
                            args = ['run', 'typecheck'];
                            cwd = resolve(cwd, 'packages', monorepoPkg);
                        }
                    } catch {
                        /* skip malformed package.json */
                    }
                }
            }
        } else if (projectType === 'rust') {
            cmd = 'cargo';
            args = ['check', '--message-format=short'];
        } else if (projectType === 'go') {
            cmd = 'go';
            args = ['vet', './...'];
        } else if (projectType === 'python') {
            cmd = 'python';
            args = [
                '-m',
                'py_compile',
                ...changedFiles.map((f) => relative(cwd, f)),
            ];
        } else {
            return {
                checkType: 'typecheck',
                success: true,
                exitCode: 0,
                output: 'No typecheck tool detected for this project type.',
                errors: [],
                durationMs: Date.now() - startTime,
            };
        }

        const result = await runCommand(cmd, args, cwd, 60_000);
        const output = (result.stdout + result.stderr).slice(0, 10_000);
        const errors = parseTypecheckErrors(output, projectType);

        return {
            checkType: 'typecheck',
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            output,
            errors,
            durationMs: Date.now() - startTime,
        };
    } catch (err) {
        return {
            checkType: 'typecheck',
            success: false,
            exitCode: 1,
            output: String(err),
            errors: [{ message: String(err), severity: 'error' }],
            durationMs: Date.now() - startTime,
        };
    }
}

async function runLint(
    cwd: string,
    project: ProjectType,
    changedFiles: string[],
    autoFix: boolean,
): Promise<CheckResult & { autoFixResult?: AutoFixResult }> {
    const startTime = Date.now();
    const projectType = project.type;

    try {
        let cmd: string;
        let args: string[];

        if (projectType === 'node') {
            cmd = 'npx';
            args = autoFix
                ? [
                      'eslint',
                      '--fix',
                      '--format',
                      'stylish',
                      ...changedFiles.map((f) => relative(cwd, f)),
                  ]
                : [
                      'eslint',
                      '--format',
                      'stylish',
                      ...changedFiles.map((f) => relative(cwd, f)),
                  ];
        } else if (projectType === 'python') {
            cmd = 'python';
            args = autoFix
                ? [
                      '-m',
                      'ruff',
                      'check',
                      '--fix',
                      ...changedFiles.map((f) => relative(cwd, f)),
                  ]
                : [
                      '-m',
                      'ruff',
                      'check',
                      ...changedFiles.map((f) => relative(cwd, f)),
                  ];
        } else if (projectType === 'rust') {
            cmd = 'cargo';
            args = autoFix ? ['clippy', '--fix', '--allow-dirty'] : ['clippy'];
        } else if (projectType === 'go') {
            cmd = 'golangci-lint';
            args = ['run', ...changedFiles.map((f) => relative(cwd, f))];
        } else {
            return {
                checkType: 'lint',
                success: true,
                exitCode: 0,
                output: 'No lint tool detected for this project type.',
                errors: [],
                durationMs: Date.now() - startTime,
            };
        }

        const result = await runCommand(cmd, args, cwd, 60_000);
        const output = (result.stdout + result.stderr).slice(0, 10_000);
        const errors = parseLintErrors(output);

        // If auto-fix was attempted and there are still errors, report that
        let autoFixResult: AutoFixResult | undefined;
        if (autoFix) {
            autoFixResult = {
                success:
                    errors.filter((e) => e.severity === 'error').length === 0,
                fixedCount: 0, // We can't easily count this without re-running
                remainingErrors: errors.filter((e) => e.severity === 'error')
                    .length,
                output,
            };
        }

        return {
            checkType: 'lint',
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            output,
            errors,
            durationMs: Date.now() - startTime,
            autoFixResult,
        };
    } catch (err) {
        return {
            checkType: 'lint',
            success: false,
            exitCode: 1,
            output: String(err),
            errors: [{ message: String(err), severity: 'error' }],
            durationMs: Date.now() - startTime,
        };
    }
}

async function runTests(
    cwd: string,
    project: ProjectType,
    changedFiles: string[],
): Promise<CheckResult> {
    const startTime = Date.now();
    const projectType = project.type;

    try {
        let cmd: string;
        let args: string[];

        if (projectType === 'node') {
            // Detect test runner from package.json
            cmd = 'npx';

            // Find test files that match changed source files
            const testFiles = findRelatedTestFiles(changedFiles);
            if (testFiles.length > 0) {
                // Try vitest first, then jest
                args = [
                    'vitest',
                    'run',
                    '--reporter=verbose',
                    ...testFiles.map((f) => relative(cwd, f)),
                ];
            } else {
                // No specific test files found, run all tests
                args = ['vitest', 'run', '--reporter=verbose'];
            }
        } else if (projectType === 'rust') {
            cmd = 'cargo';
            args = ['test'];
        } else if (projectType === 'go') {
            cmd = 'go';
            args = ['test', './...'];
        } else if (projectType === 'python') {
            cmd = 'python';
            args = ['-m', 'pytest'];
        } else {
            return {
                checkType: 'test',
                success: true,
                exitCode: 0,
                output: 'No test tool detected for this project type.',
                errors: [],
                durationMs: Date.now() - startTime,
            };
        }

        const result = await runCommand(cmd, args, cwd, 120_000);
        const output = (result.stdout + result.stderr).slice(0, 10_000);
        const errors = parseTestErrors(output);

        return {
            checkType: 'test',
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            output,
            errors,
            durationMs: Date.now() - startTime,
        };
    } catch (err) {
        return {
            checkType: 'test',
            success: false,
            exitCode: 1,
            output: String(err),
            errors: [{ message: String(err), severity: 'error' }],
            durationMs: Date.now() - startTime,
        };
    }
}

// ─── Error parsers ──────────────────────────────────────────────────────────

function parseTypecheckErrors(
    output: string,
    projectType: string,
): CheckError[] {
    const errors: CheckError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
        if (!line.trim()) continue;

        // TypeScript: "file.ts(10,5): error TS2345: ..."
        const tsMatch = line.match(
            /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/,
        );
        if (tsMatch) {
            errors.push({
                file: tsMatch[1]!,
                line: parseInt(tsMatch[2]!, 10),
                column: parseInt(tsMatch[3]!, 10),
                message: tsMatch[5]!,
                rule: tsMatch[4]!,
                severity: 'error',
            });
            continue;
        }

        // Rust: "error[E0308]: mismatched types" or "  --> file.rs:10:5"
        if (projectType === 'rust') {
            const rustErrMatch = line.match(/^error\[(.+?)\]:\s+(.+)$/);
            if (rustErrMatch) {
                errors.push({
                    message: rustErrMatch[2]!,
                    rule: rustErrMatch[1]!,
                    severity: 'error',
                });
                continue;
            }
            const rustLocMatch = line.match(/^\s+-->\s+(.+?):(\d+):(\d+)/);
            if (rustLocMatch && errors.length > 0) {
                const last = errors[errors.length - 1]!;
                last.file = rustLocMatch[1]!;
                last.line = parseInt(rustLocMatch[2]!, 10);
                last.column = parseInt(rustLocMatch[3]!, 10);
                continue;
            }
        }

        // Go: "file.go:10:5: some error"
        if (projectType === 'go') {
            const goMatch = line.match(/^(.+?):(\d+):\d+:\s+(.+)$/);
            if (goMatch) {
                errors.push({
                    file: goMatch[1]!,
                    line: parseInt(goMatch[2]!, 10),
                    message: goMatch[3]!,
                    severity: 'error',
                });
                continue;
            }
        }

        // Generic error detection
        if (line.toLowerCase().includes('error')) {
            errors.push({ message: line.trim(), severity: 'error' });
        }
    }

    return errors;
}

function parseLintErrors(output: string): CheckError[] {
    const errors: CheckError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
        if (!line.trim()) continue;

        // ESLint: "file.ts:10:5: error - message (rule-name)"
        const eslintMatch = line.match(
            /^(.+?):(\d+):\d+:\s+(error|warning)\s+-\s+(.+?)(?:\s+\(([^)]+)\))?$/,
        );
        if (eslintMatch) {
            errors.push({
                file: eslintMatch[1]!,
                line: parseInt(eslintMatch[2]!, 10),
                message: eslintMatch[4]!,
                rule: eslintMatch[5],
                severity: eslintMatch[3] as 'error' | 'warning',
            });
            continue;
        }

        // Ruff: "file.py:10:5: E302 expected 2 blank lines"
        const ruffMatch = line.match(/^(.+?):(\d+):\d+:\s+([A-Z]\d+)\s+(.+)$/);
        if (ruffMatch) {
            errors.push({
                file: ruffMatch[1]!,
                line: parseInt(ruffMatch[2]!, 10),
                message: ruffMatch[4]!,
                rule: ruffMatch[3],
                severity: ruffMatch[3]?.startsWith('E') ? 'error' : 'warning',
            });
            continue;
        }

        // Generic warning/error detection
        const warnMatch = line.match(/\b(warning|error)\b[:\s]+(.+)/i);
        if (warnMatch) {
            errors.push({
                message: warnMatch[2]?.trim() ?? '',
                severity:
                    warnMatch[1]?.toLowerCase() === 'error'
                        ? 'error'
                        : 'warning',
            });
        }
    }

    return errors;
}

function parseTestErrors(output: string): CheckError[] {
    const errors: CheckError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
        if (!line.trim()) continue;

        // vitest/jest FAIL: "  ✗ test name"
        const failMatch = line.match(/(?:FAIL|✕|✗|×)\s+(.+)/);
        if (failMatch) {
            errors.push({
                message: `Test failed: ${failMatch[1]}`,
                severity: 'error',
            });
            continue;
        }

        // Assertion errors: "Expected X to equal Y"
        if (
            line.includes('Expected') &&
            (line.includes('to equal') || line.includes('to be'))
        ) {
            errors.push({ message: line.trim(), severity: 'error' });
            continue;
        }

        // Rust test panics: "thread 'test_name' panicked"
        const panicMatch = line.match(/thread '(.+?)' panicked/);
        if (panicMatch) {
            errors.push({
                message: `Test panicked: ${panicMatch[1]}`,
                severity: 'error',
            });
            continue;
        }
    }

    return errors;
}

// ─── Test file detection ────────────────────────────────────────────────────

function findRelatedTestFiles(sourceFiles: string[]): string[] {
    const testFiles: string[] = [];

    for (const srcFile of sourceFiles) {
        const dir = srcFile.substring(0, srcFile.lastIndexOf('/'));
        const basename = srcFile.substring(srcFile.lastIndexOf('/') + 1);
        const ext = basename.substring(basename.lastIndexOf('.'));
        const nameWithoutExt = basename.substring(0, basename.lastIndexOf('.'));

        // Check common test file locations
        const candidates = [
            resolve(dir, `${nameWithoutExt}.test${ext}`),
            resolve(dir, `${nameWithoutExt}.spec${ext}`),
            resolve(dir, '__tests__', basename),
            resolve(dir, '__tests__', `${nameWithoutExt}.test${ext}`),
        ];

        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                testFiles.push(candidate);
            }
        }
    }

    return [...new Set(testFiles)];
}

// ─── Pipeline singleton ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: PipelineConfig = {
    enabled: true,
    typecheckEnabled: true,
    lintEnabled: true,
    testEnabled: false, // Tests are slow, disabled by default
    autoFixEnabled: true,
    debounceMs: 500,
    maxOutputLength: 10_000,
};

class AutoFixPipeline {
    private config: PipelineConfig = { ...DEFAULT_CONFIG };
    private modifiedFiles: Set<string> = new Set();
    private pendingReport: ValidationReport | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastReport: ValidationReport | null = null;
    private projectType: ProjectType | null = null;
    private cwd: string = process.cwd();

    /**
     * Update pipeline configuration.
     */
    updateConfig(config: Partial<PipelineConfig>): void {
        this.config = { ...this.config, ...config };
        debug.log('auto-fix', 'Config updated', this.config);
    }

    getConfig(): Readonly<PipelineConfig> {
        return this.config;
    }

    /**
     * Record that a file was modified. This queues it for validation.
     */
    recordModification(filePath: string): void {
        if (!this.config.enabled) return;
        if (!isSourceFile(filePath)) return;

        this.modifiedFiles.add(filePath);
        debug.log('auto-fix', `Recorded modification: ${filePath}`);

        // Reset debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.flush();
        }, this.config.debounceMs);
    }

    /**
     * Immediately flush pending modifications and run checks.
     */
    async flush(): Promise<ValidationReport | null> {
        if (this.modifiedFiles.size === 0) return null;

        const files = [...this.modifiedFiles];
        this.modifiedFiles.clear();

        return this.runChecks(files);
    }

    /**
     * Run validation checks on the given files.
     * This is the core of the auto-fix pipeline.
     */
    async runChecks(
        files: string[],
        options?: {
            typecheck?: boolean;
            lint?: boolean;
            test?: boolean;
            autoFix?: boolean;
        },
    ): Promise<ValidationReport> {
        const startTime = Date.now();
        const cwd = this.cwd;

        // Detect project type if not cached
        if (!this.projectType) {
            this.projectType = detectProjectType(cwd);
        }

        const project = this.projectType;
        const runTypecheck = options?.typecheck ?? this.config.typecheckEnabled;
        const runLint = options?.lint ?? this.config.lintEnabled;
        const runTest = options?.test ?? this.config.testEnabled;
        const autoFix = options?.autoFix ?? this.config.autoFixEnabled;

        debug.log('auto-fix', `Running checks on ${files.length} files`, {
            typecheck: runTypecheck,
            lint: runLint,
            test: runTest,
            autoFix,
        });

        const results: CheckResult[] = [];

        // Run checks in parallel
        const checkPromises: Promise<CheckResult>[] = [];

        if (runTypecheck && project.hasTypecheck) {
            checkPromises.push(runTypecheckCheck(cwd, project, files));
        }
        if (runLint && project.hasLint) {
            checkPromises.push(runLintCheck(cwd, project, files, autoFix));
        }
        if (runTest && project.hasTest) {
            checkPromises.push(runTestCheck(cwd, project, files));
        }

        const checkResults = await Promise.allSettled(checkPromises);

        for (const result of checkResults) {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            } else {
                results.push({
                    checkType: 'typecheck',
                    success: false,
                    exitCode: 1,
                    output: String(result.reason),
                    errors: [
                        { message: String(result.reason), severity: 'error' },
                    ],
                    durationMs: 0,
                });
            }
        }

        const allSuccess = results.every((r) => r.success);
        const allErrors = results.flatMap((r) => r.errors);
        const errorCount = allErrors.filter(
            (e) => e.severity === 'error',
        ).length;
        const warningCount = allErrors.filter(
            (e) => e.severity === 'warning',
        ).length;

        // Auto-fix lint if enabled and there are errors
        let autoFixResult: AutoFixResult | undefined;
        if (autoFix && !allSuccess && runLint && project.hasLint) {
            const lintResult = results.find((r) => r.checkType === 'lint');
            if (lintResult && !lintResult.success) {
                // Re-run lint with --fix
                const fixedResult = await runLintCheck(
                    cwd,
                    project,
                    files,
                    true,
                );
                autoFixResult = fixedResult.autoFixResult;

                // If auto-fix resolved all errors, update the lint result
                if (autoFixResult?.success) {
                    lintResult.success = true;
                    lintResult.output = fixedResult.output;
                    lintResult.errors = fixedResult.errors;
                }
            }
        }

        const summary = formatSummary(
            results,
            errorCount,
            warningCount,
            autoFixResult,
        );

        const report: ValidationReport = {
            timestamp: Date.now(),
            filesChecked: files,
            results,
            success: allSuccess,
            summary,
            autoFixAttempted: autoFix && !allSuccess,
            autoFixResult,
        };

        this.lastReport = report;
        this.pendingReport = report;

        debug.log(
            'auto-fix',
            `Validation complete: ${allSuccess ? 'PASS' : 'FAIL'} (${Date.now() - startTime}ms)`,
        );

        return report;
    }

    /**
     * Get the last validation report.
     */
    getLastReport(): ValidationReport | null {
        return this.lastReport;
    }

    /**
     * Get and clear the pending report (consumed by the validateCode tool).
     */
    consumePendingReport(): ValidationReport | null {
        const report = this.pendingReport;
        this.pendingReport = null;
        return report;
    }

    /**
     * Force re-detection of project type.
     */
    resetProjectType(): void {
        this.projectType = null;
    }

    /**
     * Set the working directory for checks.
     */
    setCwd(cwd: string): void {
        this.cwd = cwd;
        this.projectType = null; // Reset project type when cwd changes
    }

    /**
     * Get all currently tracked modified files.
     */
    getModifiedFiles(): string[] {
        return [...this.modifiedFiles];
    }

    /**
     * Clear all tracked modifications.
     */
    clearModifications(): void {
        this.modifiedFiles.clear();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}

// Helper functions that wrap the check runners with proper signatures
function runTypecheckCheck(
    cwd: string,
    project: ProjectType,
    files: string[],
): Promise<CheckResult> {
    return runTypecheck(cwd, project, files);
}

function runLintCheck(
    cwd: string,
    project: ProjectType,
    files: string[],
    autoFix: boolean,
): Promise<CheckResult & { autoFixResult?: AutoFixResult }> {
    return runLint(cwd, project, files, autoFix);
}

function runTestCheck(
    cwd: string,
    project: ProjectType,
    files: string[],
): Promise<CheckResult> {
    return runTests(cwd, project, files);
}

function formatSummary(
    results: CheckResult[],
    errorCount: number,
    warningCount: number,
    autoFixResult?: AutoFixResult,
): string {
    const parts: string[] = [];

    for (const result of results) {
        const icon = result.success ? '✅' : '❌';
        const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
        parts.push(`${icon} ${result.checkType} (${duration})`);
    }

    if (errorCount > 0 || warningCount > 0) {
        parts.push('');
        if (errorCount > 0) parts.push(`🔴 ${errorCount} error(s)`);
        if (warningCount > 0) parts.push(`🟡 ${warningCount} warning(s)`);
    }

    if (autoFixResult) {
        parts.push('');
        if (autoFixResult.success) {
            parts.push('🔧 Auto-fix resolved all issues');
        } else {
            parts.push(
                `🔧 Auto-fix: ${autoFixResult.remainingErrors} error(s) remain`,
            );
        }
    }

    return parts.join('\n');
}

// Export singleton
export const autoFixPipeline = new AutoFixPipeline();
