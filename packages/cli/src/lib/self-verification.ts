/**
 * Self-Verification & Trust System
 *
 * Provides confidence scoring, file consistency checks, and multi-pass
 * verification for critical operations. Helps the agent verify its own
 * work before declaring completion.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';

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
    // Too many retries or editFile calls may indicate struggling
    const editCount =
        (toolUsage.get('editFile') ?? 0) +
        (toolUsage.get('searchReplace') ?? 0);
    const readFileCount = toolUsage.get('readFile') ?? 0;
    const bashCount = toolUsage.get('bash') ?? 0;

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
const CRITICAL_TOOLS = new Set([
    'gitCommit',
    'deleteFile',
    'moveFile',
    'renameSymbol',
]);

/**
 * Check if a tool call is critical and needs multi-pass verification.
 */
export function isCriticalOperation(toolName: string, input: any): boolean {
    if (CRITICAL_TOOLS.has(toolName)) return true;

    // Bash commands that are destructive.
    // NOTE: This heuristic parses only the leading command tokens and has
    // inherent limitations — it may not catch aliased commands, subshells,
    // variable expansions, or unusual invocations of destructive operations.
    if (toolName === 'bash' && typeof input?.command === 'string') {
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
    output: string,
): string {
    const parts: string[] = [
        'The previous operation was critical. Please verify:',
        '',
    ];

    if (toolName === 'gitCommit') {
        parts.push('1. The commit message accurately describes the changes');
        parts.push('2. Only intended files were included (check git status)');
        parts.push('3. No sensitive data was committed');
    } else if (toolName === 'deleteFile') {
        parts.push(
            `1. The file ${input?.path ?? 'unknown'} was intentionally deleted`,
        );
        parts.push('2. No other files depend on the deleted file');
        parts.push('3. The deletion was not a mistake');
    } else if (toolName === 'moveFile') {
        parts.push(
            `1. Moving ${input?.from ?? '?'} → ${input?.to ?? '?'} is correct`,
        );
        parts.push('2. All references to the old path have been updated');
    } else if (toolName === 'bash') {
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
