import { toolInputSchemas } from '@nightcode/shared';
import { runGit } from './utils';
import { getProjectCwd } from '../workspace-context';

export async function gitBlameTool(input: unknown) {
    const { filePath, startLine, endLine } =
        toolInputSchemas.gitBlame.parse(input);

    try {
        const args = ['blame'];
        if (startLine !== undefined && endLine !== undefined) {
            args.push('-L', `${startLine},${endLine}`);
        } else if (startLine !== undefined) {
            args.push('-L', `${startLine},+1`);
        }
        args.push(filePath);

        const result = await runGit(getProjectCwd(), args);
        if (result.exitCode !== 0) {
            return {
                success: false,
                lines: [],
                output: result.stderr || 'git blame failed',
            };
        }

        const lines = result.stdout
            .split('\n')
            .filter((line: string) => line.trim())
            .map((line: string, index: number) => {
                const match = line.match(
                    /^([0-9a-f]+)\s+\((.+?)\s+\d{4}-\d{2}-\d{2}\s+(\d+)\)\s+(.*)$/,
                );
                if (match) {
                    return {
                        lineNumber: startLine ? startLine + index : index + 1,
                        author: match[2],
                        hash: match[1],
                        content: match[4],
                    };
                }
                return {
                    lineNumber: startLine ? startLine + index : index + 1,
                    author: 'unknown',
                    hash: '',
                    content: line,
                };
            });

        return { success: true, lines };
    } catch (err) {
        return { success: false, lines: [], output: (err as Error).message };
    }
}
