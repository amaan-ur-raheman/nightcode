import { toolInputSchemas } from '@nightcode/shared';
import { runGit } from './utils';
import { getProjectCwd } from '../workspace-context';
import { preCommitSecretScan } from '../git-workflow';

export async function gitCommitTool(input: unknown) {
    const { message, files } = toolInputSchemas.gitCommit.parse(input);

    try {
        const cwd = getProjectCwd();
        const filesToStage = files && files.length > 0 ? files : [];

        // Stage files if provided
        if (filesToStage.length > 0) {
            const addResult = await runGit(cwd, ['add', ...filesToStage]);
            if (addResult.exitCode !== 0) {
                return {
                    success: false,
                    output: addResult.stderr || 'git add failed',
                };
            }
        }

        // Pre-commit secret scan on staged files
        const scanResult = await preCommitSecretScan(filesToStage);
        if (scanResult.blocked) {
            // Unstage files if secrets found
            await runGit(cwd, ['reset', 'HEAD', ...filesToStage]).catch(
                () => {},
            );
            const details = scanResult.matches
                .filter((m) => m.severity === 'high')
                .map((m) => `  ${m.file}:${m.line} — ${m.type}`)
                .join('\n');
            return {
                success: false,
                output: `Commit blocked: high-severity secrets detected:\n${details}\n\nRemove secrets before committing.`,
            };
        }

        // Make the commit
        const result = await runGit(cwd, ['commit', '-m', message]);
        if (result.exitCode !== 0) {
            return {
                success: false,
                output: result.stderr || result.stdout || 'git commit failed',
            };
        }

        const hashMatch = result.stdout.match(/\[[\w]+\s+([0-9a-f]+)\]/);
        const commitHash = hashMatch ? hashMatch[1] : undefined;

        // Append warnings for medium/low severity secrets
        let warnings = '';
        if (scanResult.medium > 0 || scanResult.low > 0) {
            const warnParts: string[] = [];
            if (scanResult.medium > 0)
                warnParts.push(`${scanResult.medium} medium`);
            if (scanResult.low > 0) warnParts.push(`${scanResult.low} low`);
            warnings = `\nWarning: ${warnParts.join(', ')} severity patterns detected — review recommended.`;
        }

        return {
            success: true,
            output: result.stdout + warnings,
            commitHash,
        };
    } catch (err) {
        return { success: false, output: (err as Error).message };
    }
}
