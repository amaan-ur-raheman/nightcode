import { resolve } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { MAX_PATCH_SIZE } from './utils';
import { undoManager } from '../undo-manager';

export async function patchTool(input: unknown) {
    const { patch } = toolInputSchemas.patch.parse(input);
    const cwd = process.cwd();

    if (patch.length > MAX_PATCH_SIZE)
        return {
            error: `Patch exceeds maximum size of ${MAX_PATCH_SIZE} characters`,
        };

    const files = new Set<string>();
    for (const match of patch.matchAll(/^\+\+\+\s+b\/([^\t\r\n]+)/gm)) {
        const targetPath = match[1]!.trim();
        if (targetPath.includes('..'))
            return { error: `Patch escapes project directory: ${targetPath}` };
        const resolved = resolve(cwd, targetPath);
        if (!resolved.startsWith(cwd.endsWith('/') ? cwd : cwd + '/')) {
            return { error: `Patch escapes project directory: ${targetPath}` };
        }
        files.add(resolved);
    }

    for (const filePath of files) {
        await undoManager.backup(filePath, 'patch', `Patch ${filePath}`);
    }

    const proc = Bun.spawn(['git', 'apply', '--reject', '--whitespace=fix'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        cwd,
    });
    proc.stdin.write(patch);
    await proc.stdin.end();
    const [, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    const diffPreview = patch
        .split('\n')
        .filter(
            (l) => l.startsWith('+') || l.startsWith('-') || l.startsWith('@'),
        )
        .slice(0, 20)
        .join('\n');

    if (proc.exitCode === 0)
        return {
            success: true as const,
            message: 'Patch applied cleanly',
            diff: diffPreview || patch.slice(0, 2000),
        };
    if (proc.exitCode === 1) {
        return {
            success: false,
            message: stderr.includes('.rej')
                ? 'Patch partially applied; some hunks were rejected (.rej files created)'
                : 'Patch failed to apply',
            stderr: stderr.slice(0, 5000),
        };
    }
    return { error: `git apply failed: ${stderr.trim()}` };
}
