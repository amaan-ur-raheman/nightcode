import { toolInputSchemas } from '@nightcode/shared';
import { autoFixPipeline, type ValidationReport } from '../auto-fix-pipeline';
import { resolveInsideCwd } from './utils';

export async function validateCodeTool(input: unknown) {
    const { files, typecheck, lint, test, autoFix } =
        toolInputSchemas.validateCode.parse(input);

    // Resolve file paths
    const resolvedFiles = (files ?? []).map((f) => {
        try {
            const { resolved } = resolveInsideCwd(f);
            return resolved;
        } catch {
            return f; // Use as-is if not inside cwd
        }
    });

    // If no files specified, use pending modifications
    const filesToCheck =
        resolvedFiles.length > 0
            ? resolvedFiles
            : autoFixPipeline.getModifiedFiles();

    if (filesToCheck.length === 0) {
        return {
            success: true as const,
            message:
                'No modified files to validate. Make some code changes first, or specify files to check.',
            report: null,
        };
    }

    // Run checks
    const report = await autoFixPipeline.runChecks(filesToCheck, {
        typecheck,
        lint,
        test,
        autoFix,
    });

    // Format the output
    const output = formatReport(report);

    return {
        success: report.success,
        output,
        report: {
            filesChecked: report.filesChecked,
            success: report.success,
            summary: report.summary,
            errors: report.results.flatMap((r) =>
                r.errors.map((e) => ({
                    check: r.checkType,
                    file: e.file,
                    line: e.line,
                    message: e.message,
                    rule: e.rule,
                    severity: e.severity,
                })),
            ),
            autoFixAttempted: report.autoFixAttempted,
            autoFixResult: report.autoFixResult,
        },
    };
}

function formatReport(report: ValidationReport): string {
    const lines: string[] = [];

    lines.push(`## Validation Report`);
    lines.push('');
    lines.push(
        `**Status:** ${report.success ? '[PASS] All checks passed' : '[FAIL] Issues found'}`,
    );
    lines.push(`**Files checked:** ${report.filesChecked.length}`);
    lines.push('');

    // Individual check results
    for (const result of report.results) {
        const icon = result.success ? '[PASS]' : '[FAIL]';
        const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
        lines.push(`### ${icon} ${result.checkType} (${duration})`);

        if (result.errors.length > 0) {
            lines.push('');
            for (const error of result.errors.slice(0, 20)) {
                const location = error.file
                    ? `${error.file}${error.line ? `:${error.line}` : ''}`
                    : '';
                const rule = error.rule ? ` (${error.rule})` : '';
                const prefix =
                    error.severity === 'error' ? '[ERROR]' : '[WARN]';
                lines.push(`- ${prefix} ${location}${rule}: ${error.message}`);
            }
            if (result.errors.length > 20) {
                lines.push(
                    `- ... and ${result.errors.length - 20} more issues`,
                );
            }
        } else {
            lines.push('');
            lines.push('No issues found.');
        }

        lines.push('');
    }

    // Auto-fix results
    if (report.autoFixResult) {
        lines.push('### [Auto-Fix]');
        lines.push('');
        if (report.autoFixResult.success) {
            lines.push('Auto-fix resolved all lint issues.');
        } else {
            lines.push(
                `Auto-fix ran but ${report.autoFixResult.remainingErrors} error(s) remain.`,
            );
            lines.push('These may require manual intervention.');
        }
        lines.push('');
    }

    // Raw output for debugging (truncated)
    if (!report.success) {
        const rawOutput = report.results
            .filter((r) => !r.success)
            .map((r) => r.output.slice(0, 2000))
            .join('\n---\n');
        if (rawOutput) {
            lines.push('<details>');
            lines.push('<summary>Raw output</summary>');
            lines.push('');
            lines.push('```');
            lines.push(rawOutput);
            lines.push('```');
            lines.push('</details>');
        }
    }

    return lines.join('\n');
}
