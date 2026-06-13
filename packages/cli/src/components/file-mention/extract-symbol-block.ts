import { readFile } from 'fs/promises';

export async function extractSymbolBlock(filePath: string, startLine: number): Promise<string> {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const startIndex = startLine - 1;
    if (startIndex < 0 || startIndex >= lines.length) return '';

    let braceCount = 0;
    let opened = false;
    const blockLines: string[] = [];

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i]!;
        blockLines.push(line);

        // Count braces, skipping strings, template literals, and comments
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        let inLineComment = false;
        let inBlockComment = false;
        let escaped = false;

        for (let ci = 0; ci < line.length; ci++) {
            const char = line[ci]!;
            const next = ci + 1 < line.length ? line[ci + 1]! : '';

            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (inLineComment || inBlockComment) {
                if (inBlockComment && char === '*' && next === '/') {
                    inBlockComment = false;
                    ci++;
                }
                continue;
            }
            if (inSingle) {
                if (char === "'") inSingle = false;
                continue;
            }
            if (inDouble) {
                if (char === '"') inDouble = false;
                continue;
            }
            if (inTemplate) {
                if (char === '`') inTemplate = false;
                continue;
            }

            // Not inside any string/comment — check for openings
            if (char === '/' && next === '/') {
                inLineComment = true;
                continue;
            }
            if (char === '/' && next === '*') {
                inBlockComment = true;
                ci++;
                continue;
            }
            if (char === "'") { inSingle = true; continue; }
            if (char === '"') { inDouble = true; continue; }
            if (char === '`') { inTemplate = true; continue; }

            // Count braces only outside strings/comments
            if (char === '{') {
                braceCount++;
                opened = true;
            } else if (char === '}') {
                braceCount--;
            }
        }

        // Stop conditions:
        // 1. We opened braces and they balanced back to 0
        if (opened && braceCount <= 0) {
            break;
        }
        // 2. We read 40 lines (max limit to prevent overflow)
        if (blockLines.length >= 40) {
            break;
        }
    }

    return blockLines.join('\n');
}
