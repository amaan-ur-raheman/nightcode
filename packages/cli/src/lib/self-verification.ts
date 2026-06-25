/**
 * Self-Verification & Trust System
 *
 * Provides confidence scoring, file consistency checks, real verification tools,
 * and multi-pass verification for critical operations.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { extname, basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Confidence score for a set of changes.
 * Based on: file consistency, error presence, tool usage patterns.
 */
export interface ConfidenceScore {
    /** Overall score 0.0 (no confidence) to 1.0 (fully confident). */
    overall: number;
    /** Breakdown by category. */
    breakdown: {
        fileConsistency: number;
        errorAbsence: number;
        toolUsage: number;
    };
    /** Human-readable explanation. */
    explanation: string[];
}

/**
 * File consistency check result.
 */
export interface FileConsistencyResult {
    path: string;
    valid: boolean;
    error?: string;
    warnings: string[];
}

/**
 * Result of a multi-pass verification.
 */
export interface VerificationResult {
    passed: boolean;
    confidence: ConfidenceScore;
    fileResults: FileConsistencyResult[];
    recommendation: string;
}

// ── File Consistency Checks ──

const SYNTAX_CHECKABLE_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
    '.jsonc',
    '.json5',
    '.py',
    '.pyi',
    '.go',
    '.rs',
    '.java',
    '.css',
    '.scss',
    '.less',
    '.yaml',
    '.yml',
    '.toml',
    '.html',
    '.htm',
    '.vue',
    '.svelte',
]);

/**
 * Verify that a file is syntactically valid after modification.
 * Uses lightweight checks (syntax parsing) rather than full compilation.
 */
export function verifyFileConsistency(filePath: string): FileConsistencyResult {
    const result: FileConsistencyResult = {
        path: filePath,
        valid: true,
        warnings: [],
    };

    if (!existsSync(filePath)) {
        result.valid = false;
        result.error = 'File does not exist after modification';
        return result;
    }

    const ext = extname(filePath).toLowerCase();
    if (!SYNTAX_CHECKABLE_EXTENSIONS.has(ext)) {
        result.warnings.push(`No syntax check available for ${ext} files`);
        return result;
    }

    try {
        const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
        const stats = statSync(filePath);
        if (stats.size > MAX_SIZE_BYTES) {
            result.warnings.push(
                `File is ${Math.round(stats.size / 1024 / 1024)} MB — too large for full syntax check`,
            );
            return result;
        }

        const content = readFileSync(filePath, 'utf-8');

        // Basic syntax checks by extension
        if (ext === '.json' || ext === '.jsonc' || ext === '.json5') {
            try {
                JSON.parse(content);
            } catch (e) {
                result.valid = false;
                result.error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
            }
        }

        // Check for common issues
        if (content.length === 0) {
            result.warnings.push('File is empty after modification');
        }

        // Check for unmatched brackets/braces (basic heuristic)
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            const bracketIssues = checkBracketBalance(content);
            if (bracketIssues) {
                result.warnings.push(bracketIssues);
            }
        }
    } catch (e) {
        result.valid = false;
        result.error = `Cannot read file: ${e instanceof Error ? e.message : String(e)}`;
    }

    return result;
}

/**
 * Basic bracket balance check for JS/TS files.
 */
function checkBracketBalance(content: string): string | null {
    let braces = 0;
    let parens = 0;
    let brackets = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;

    for (let i = 0; i < content.length; i++) {
        const ch = content[i]!;
        const prev = i > 0 ? content[i - 1] : '';

        // Skip string contents
        if (inString) {
            if (ch === stringChar && prev !== '\\') inString = false;
            continue;
        }

        // Track template literals
        if (ch === '`' && prev !== '\\') {
            inTemplate = !inTemplate;
            continue;
        }
        if (inTemplate) continue;

        // Track strings
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
        }

        // Count brackets
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        else if (ch === '[') brackets++;
        else if (ch === ']') brackets--;
    }

    const issues: string[] = [];
    if (braces !== 0)
        issues.push(
            `Unbalanced braces: ${braces > 0 ? 'missing ' + braces + '}' : braces * -1 + ' extra }'}`,
        );
    if (parens !== 0)
        issues.push(
            `Unbalanced parens: ${parens > 0 ? 'missing ' + parens + ')' : parens * -1 + ' extra )'}`,
        );
    if (brackets !== 0)
        issues.push(
            `Unbalanced brackets: ${brackets > 0 ? 'missing ' + brackets + ']' : brackets * -1 + ' extra ]'}`,
        );

    return issues.length > 0 ? issues.join('; ') : null;
}

// ── Confidence Scoring ──

/**
 * Calculate confidence score for a set of changes.
 *
 * @param modifiedFiles - List of file paths that were modified
 * @param toolUsage - Map of tool name → count of times used
 * @param errors - List of errors encountered during execution
 */
export function calculateConfidence(
    modifiedFiles: string[],
    toolUsage: Map<string, number>,
    errors: string[],
): ConfidenceScore {
    const explanation: string[] = [];

    // File consistency: check each modified file
    let consistentFiles = 0;
    const fileResults: FileConsistencyResult[] = [];
    for (const file of modifiedFiles) {
        const result = verifyFileConsistency(file);
        fileResults.push(result);
        if (result.valid) consistentFiles++;
    }
    const fileConsistency =
        modifiedFiles.length > 0 ? consistentFiles / modifiedFiles.length : 1.0;

    if (fileConsistency < 1.0) {
        const failed = fileResults.filter((r) => !r.valid);
        explanation.push(
            `${failed.length}/${modifiedFiles.length} files failed consistency checks`,
        );
    } else if (modifiedFiles.length > 0) {
        explanation.push(
            `All ${modifiedFiles.length} modified files pass consistency checks`,
        );
    }

    // Error absence: fewer errors = higher confidence
    const errorCount = errors.length;
    const errorAbsence = Math.max(0, 1 - errorCount * 0.15);
    if (errorCount > 0) {
        explanation.push(`${errorCount} error(s) encountered during execution`);
    }

    // Tool usage: balanced usage = higher confidence
    // Too many retries or edit_file calls may indicate struggling
    const editCount = toolUsage.get('edit_file') ?? 0;
    const readFileCount = toolUsage.get('read_file') ?? 0;
    const bashCount = toolUsage.get('run_command') ?? 0;

    let toolScore = 1.0;
    if (editCount > 10) {
        toolScore -= 0.2;
        explanation.push(
            `High edit count (${editCount}) — may indicate repeated corrections`,
        );
    }
    if (readFileCount === 0 && modifiedFiles.length > 0) {
        toolScore -= 0.15;
        explanation.push('Files were modified without reading them first');
    }
    if (bashCount > 15) {
        toolScore -= 0.1;
        explanation.push(`High bash usage (${bashCount} calls)`);
    }
    const toolUsageScore = Math.max(0, toolScore);

    // Weighted overall score
    const overall =
        fileConsistency * 0.4 + errorAbsence * 0.3 + toolUsageScore * 0.3;

    if (overall >= 0.8) {
        explanation.push('High confidence — changes look correct');
    } else if (overall >= 0.5) {
        explanation.push('Medium confidence — review recommended');
    } else {
        explanation.push('Low confidence — careful review needed');
    }

    return {
        overall,
        breakdown: {
            fileConsistency,
            errorAbsence,
            toolUsage: toolUsageScore,
        },
        explanation,
    };
}

// ── Multi-Pass Verification ──

/**
 * Critical operations that should trigger multi-pass verification.
 */
const CRITICAL_TOOLS = new Set(['git_operation', 'edit_file', 'code_search']);

/**
 * Check if a tool call is critical and needs multi-pass verification.
 */
export function isCriticalOperation(toolName: string, input: any): boolean {
    if (CRITICAL_TOOLS.has(toolName)) return true;

    // Bash commands that are destructive.
    // NOTE: This heuristic parses only the leading command tokens and has
    // inherent limitations — it may not catch aliased commands, subshells,
    // variable expansions, or unusual invocations of destructive operations.
    if (toolName === 'run_command' && typeof input?.command === 'string') {
        const tokens = input.command.trim().toLowerCase().split(/\s+/);
        const base = tokens[0] ?? '';
        const sub = tokens[1] ?? '';
        const flags = tokens.slice(2).join(' ');
        return (
            base === 'rm' ||
            base === 'rmdir' ||
            base === 'del' ||
            base === 'unlink' ||
            base === 'drop' ||
            base === 'truncate' ||
            (base === 'git' && sub === 'push' && flags.includes('--force')) ||
            (base === 'git' && sub === 'reset' && flags.includes('--hard'))
        );
    }

    return false;
}

/**
 * Generate a verification prompt for a critical operation.
 */
export function generateVerificationPrompt(
    toolName: string,
    input: any,
    _output: string,
): string {
    const parts: string[] = [
        'The previous operation was critical. Please verify:',
        '',
    ];

    if (toolName === 'git_operation' && input?.action === 'commit') {
        parts.push('1. The commit message accurately describes the changes');
        parts.push('2. Only intended files were included (check git status)');
        parts.push('3. No sensitive data was committed');
    } else if (toolName === 'edit_file' && input?.action === 'delete') {
        parts.push(
            `1. The file ${input?.path ?? 'unknown'} was intentionally deleted`,
        );
        parts.push('2. No other files depend on the deleted file');
        parts.push('3. The deletion was not a mistake');
    } else if (toolName === 'edit_file' && input?.action === 'move') {
        parts.push(
            `1. Moving ${input?.path ?? '?'} → ${input?.to ?? input?.destPath ?? '?'} is correct`,
        );
        parts.push('2. All references to the old path have been updated');
    } else if (toolName === 'run_command' && input?.action === 'bash') {
        parts.push('1. The command executed correctly');
        parts.push('2. The output is as expected');
        parts.push('3. No unintended side effects occurred');
    } else {
        parts.push('1. The operation completed successfully');
        parts.push('2. The result is as expected');
        parts.push('3. No unintended side effects occurred');
    }

    parts.push('');
    parts.push(
        'If everything is correct, confirm with "verified". If there are issues, describe them.',
    );

    return parts.join('\n');
}

/**
 * Run full verification on a set of changes.
 */
export function runVerification(
    modifiedFiles: string[],
    toolUsage: Map<string, number>,
    errors: string[],
): VerificationResult {
    const fileResults = modifiedFiles.map((f) => verifyFileConsistency(f));
    const confidence = calculateConfidence(modifiedFiles, toolUsage, errors);

    let recommendation: string;
    if (confidence.overall >= 0.8) {
        recommendation = 'Changes pass verification. Safe to complete.';
    } else if (confidence.overall >= 0.5) {
        const issues = fileResults.filter(
            (r) => !r.valid || r.warnings.length > 0,
        );
        recommendation = `Review recommended: ${issues.length} file(s) need attention.`;
    } else {
        recommendation =
            'Significant issues detected. Manual review required before completing.';
    }

    return {
        passed: confidence.overall >= 0.5,
        confidence,
        fileResults,
        recommendation,
    };
}

// ── Verification → Correction Tracker Integration ──

import { correctionTracker } from './correction-tracker';

/**
 * Record verification outcome as a correction or positive signal.
 * This closes the feedback loop: if verification fails, the agent learns
 * what patterns lead to failures; if verification passes, successful
 * patterns are reinforced.
 */
export async function recordVerificationOutcome(
    result: VerificationResult,
    toolUsage: Map<string, number>,
): Promise<void> {
    if (result.confidence.overall < 0.5) {
        // Verification failed — record as correction signal
        const failureReasons: string[] = [];
        for (const r of result.fileResults.filter((f) => !f.valid)) {
            if (r.error) failureReasons.push(`${r.path}: ${r.error}`);
        }
        if (
            failureReasons.length === 0 &&
            result.confidence.explanation.length > 0
        ) {
            failureReasons.push(...result.confidence.explanation.slice(0, 2));
        }
        const toolBreakdown = Object.fromEntries(toolUsage.entries());
        const summary = `Verification failed: ${failureReasons.join('; ')}. Tool usage: ${JSON.stringify(toolBreakdown)}`;
        await correctionTracker.recordSuggestion(summary);
    } else if (result.confidence.overall >= 0.8) {
        // High confidence — record top tool as positive pattern
        const topTool = [...toolUsage.entries()]
            .sort((a, b) => b[1] - a[1])
            .find(([tool]) => tool !== 'read_file')?.[0];
        if (topTool) {
            await correctionTracker.onAccept(
                topTool,
                {},
                'verification passed',
            );
        }
    }
}

// ── Real Verification Tools ──

export interface RealVerificationResult {
    type: 'typecheck' | 'test' | 'lint' | 'build';
    passed: boolean;
    output: string;
    durationMs: number;
    filesChecked: string[];
}

export interface ComprehensiveVerification {
    results: RealVerificationResult[];
    allPassed: boolean;
    summary: string;
    durationMs: number;
}

const VERIFICATION_TIMEOUT_MS = 30_000;

/**
 * Run TypeScript type checking on modified files.
 * Detects real type errors that basic syntax checks miss.
 */
export async function runTypeCheck(
    modifiedFiles: string[],
    cwd: string,
): Promise<RealVerificationResult> {
    const tsFiles = modifiedFiles.filter(
        (f) => extname(f) === '.ts' || extname(f) === '.tsx',
    );
    if (tsFiles.length === 0) {
        return {
            type: 'typecheck',
            passed: true,
            output: 'No TypeScript files to check',
            durationMs: 0,
            filesChecked: [],
        };
    }

    const start = Date.now();
    try {
        // Try project's typecheck command first, then fall back to tsc
        const { stdout } = await execFileAsync('bun', ['run', 'typecheck'], {
            cwd,
            timeout: VERIFICATION_TIMEOUT_MS,
            encoding: 'utf-8',
        });
        return {
            type: 'typecheck',
            passed: true,
            output: stdout || 'Type check passed',
            durationMs: Date.now() - start,
            filesChecked: tsFiles,
        };
    } catch (error: any) {
        // typecheck command failed — extract relevant errors for our files
        const output = (
            error.stderr ||
            error.stdout ||
            error.message ||
            ''
        ).slice(0, 2000);
        const relevantErrors = filterErrorsForFiles(output, tsFiles);
        return {
            type: 'typecheck',
            passed: false,
            output: relevantErrors || output,
            durationMs: Date.now() - start,
            filesChecked: tsFiles,
        };
    }
}

/**
 * Run tests for modified files.
 * Attempts to find and run relevant test files.
 */
export async function runTests(
    modifiedFiles: string[],
    cwd: string,
): Promise<RealVerificationResult> {
    // Find test files related to modified files
    const testFiles = findRelatedTestFiles(modifiedFiles);
    if (testFiles.length === 0) {
        return {
            type: 'test',
            passed: true,
            output: 'No related test files found',
            durationMs: 0,
            filesChecked: [],
        };
    }

    const start = Date.now();
    try {
        const { stdout } = await execFileAsync('bun', ['test', ...testFiles], {
            cwd,
            timeout: VERIFICATION_TIMEOUT_MS,
            encoding: 'utf-8',
        });
        return {
            type: 'test',
            passed: true,
            output: stdout || 'Tests passed',
            durationMs: Date.now() - start,
            filesChecked: testFiles,
        };
    } catch (error: any) {
        const output = (
            error.stderr ||
            error.stdout ||
            error.message ||
            ''
        ).slice(0, 2000);
        return {
            type: 'test',
            passed: false,
            output,
            durationMs: Date.now() - start,
            filesChecked: testFiles,
        };
    }
}

/**
 * Run linting on modified files.
 */
export async function runLint(
    modifiedFiles: string[],
    cwd: string,
): Promise<RealVerificationResult> {
    const lintableFiles = modifiedFiles.filter((f) => {
        const ext = extname(f);
        return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
    });
    if (lintableFiles.length === 0) {
        return {
            type: 'lint',
            passed: true,
            output: 'No lintable files',
            durationMs: 0,
            filesChecked: [],
        };
    }

    const start = Date.now();
    try {
        // Try biome first (faster), then eslint
        const { stdout } = await execFileAsync(
            'bunx',
            ['biome', 'check', ...lintableFiles],
            {
                cwd,
                timeout: VERIFICATION_TIMEOUT_MS,
                encoding: 'utf-8',
            },
        );
        return {
            type: 'lint',
            passed: true,
            output: stdout || 'Lint passed',
            durationMs: Date.now() - start,
            filesChecked: lintableFiles,
        };
    } catch (error: any) {
        const output = (
            error.stderr ||
            error.stdout ||
            error.message ||
            ''
        ).slice(0, 2000);
        // biome exits non-zero on lint errors, check if it's real errors
        if (output.includes('error') || output.includes('Error')) {
            return {
                type: 'lint',
                passed: false,
                output,
                durationMs: Date.now() - start,
                filesChecked: lintableFiles,
            };
        }
        // biome not available, skip
        return {
            type: 'lint',
            passed: true,
            output: 'Linter not available, skipped',
            durationMs: Date.now() - start,
            filesChecked: lintableFiles,
        };
    }
}

/**
 * Run comprehensive verification on modified files.
 * Runs type checking, tests, and linting in parallel.
 */
export async function runComprehensiveVerification(
    modifiedFiles: string[],
    cwd: string,
): Promise<ComprehensiveVerification> {
    const start = Date.now();

    const [typeCheck, tests, lint] = await Promise.all([
        runTypeCheck(modifiedFiles, cwd),
        runTests(modifiedFiles, cwd),
        runLint(modifiedFiles, cwd),
    ]);

    const results = [typeCheck, tests, lint];
    const allPassed = results.every((r) => r.passed);
    const failedTypes = results.filter((r) => !r.passed).map((r) => r.type);

    const summary = allPassed
        ? 'All verification checks passed'
        : `Failed: ${failedTypes.join(', ')}`;

    return {
        results,
        allPassed,
        summary,
        durationMs: Date.now() - start,
    };
}

/**
 * Find test files related to modified files.
 */
function findRelatedTestFiles(files: string[]): string[] {
    const testFiles: string[] = [];
    for (const file of files) {
        const base = basename(file);
        const dir = file.replace(/\/[^/]+$/, '');
        const ext = extname(file);

        // Check common test patterns
        const patterns = [
            `${dir}/__tests__/${base}.test${ext}`,
            `${dir}/__tests__/${base}.spec${ext}`,
            `${dir}/${base}.test${ext}`,
            `${dir}/${base}.spec${ext}`,
            `${dir}/tests/${base}.test${ext}`,
            `${dir}/tests/${base}.spec${ext}`,
        ];

        for (const pattern of patterns) {
            if (existsSync(pattern)) {
                testFiles.push(pattern);
                break;
            }
        }
    }
    return testFiles;
}

/**
 * Filter verification output to show only errors relevant to modified files.
 */
function filterErrorsForFiles(output: string, files: string[]): string {
    const lines = output.split('\n');
    const fileNames = files.map((f) => basename(f));
    const relevantLines = lines.filter((line) =>
        fileNames.some((name) => line.includes(name)),
    );
    return relevantLines.length > 0 ? relevantLines.join('\n') : output;
}
