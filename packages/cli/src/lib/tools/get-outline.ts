import { relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { readCachedFile, resolveInsideCwd } from './utils';

const PATTERNS: [string, RegExp][] = [
    ['class', /^(?:export\s+)?(?:abstract\s+)?class\s+(?<name>\w+)/],
    [
        'function',
        /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(?<name>\w+)\s*[\(<]/,
    ],
    [
        'arrow',
        /^(?:export\s+)?(?:const|let|var)\s+(?<name>\w+)\s*=\s*(?:async\s+)?\(/,
    ],
    ['const', /^(?:export\s+)?(?:const|let|var)\s+(?<name>\w+)\s*=/],
    ['type', /^(?:export\s+)?type\s+(?<name>\w+)\s*=/],
    ['interface', /^(?:export\s+)?interface\s+(?<name>\w+)/],
    ['enum', /^(?:export\s+)?(?:const\s+)?enum\s+(?<name>\w+)/],
    ['def', /^(?:async\s+)?def\s+(?<name>\w+)\s*\(/],
    ['func', /^func\s+(?<name>\w+)\s*\(/],
    ['fn', /^(?:pub\s+)?(?:async\s+)?fn\s+(?<name>\w+)\s*[(<]/],
];

export async function getOutlineTool(input: unknown) {
    const { path } = toolInputSchemas.getOutline.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const lines = (await readCachedFile(resolved)).split('\n');
    const symbols: { name: string; kind: string; line: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trimStart();
        for (const [kind, pattern] of PATTERNS) {
            const match = pattern.exec(line);
            if (match?.groups?.name) {
                symbols.push({ name: match.groups.name, kind, line: i + 1 });
                break;
            }
        }
    }

    return { path: relative(cwd, resolved), symbols };
}
