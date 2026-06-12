export interface DiffLine {
    type: 'add' | 'remove' | 'context';
    content: string;
    lineNumber: number;
}

export function generateDiff(
    oldContent: string,
    newContent: string,
): DiffLine[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diff: DiffLine[] = [];

    const n = oldLines.length;
    const m = newLines.length;

    const dp: number[][] = Array.from({ length: n + 1 }, () =>
        new Array(m + 1).fill(0),
    );

    for (let i = 1; i <= n; i++) {
        const row = dp[i]!;
        const prevRow = dp[i - 1]!;
        for (let j = 1; j <= m; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                row[j] = prevRow[j - 1]! + 1;
            } else {
                row[j] = Math.max(prevRow[j]!, row[j - 1]!);
            }
        }
    }

    let i = n;
    let j = m;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            diff.unshift({
                type: 'context',
                content: oldLines[i - 1]!,
                lineNumber: 0,
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
            diff.unshift({
                type: 'add',
                content: newLines[j - 1]!,
                lineNumber: 0,
            });
            j--;
        } else {
            diff.unshift({
                type: 'remove',
                content: oldLines[i - 1]!,
                lineNumber: 0,
            });
            i--;
        }
    }

    let oldLineNum = 1;
    let newLineNum = 1;

    for (const line of diff) {
        if (line.type === 'context') {
            line.lineNumber = oldLineNum;
            oldLineNum++;
            newLineNum++;
        } else if (line.type === 'remove') {
            line.lineNumber = oldLineNum;
            oldLineNum++;
        } else if (line.type === 'add') {
            line.lineNumber = newLineNum;
            newLineNum++;
        }
    }

    return diff;
}

export function toUnifiedDiff(
    path: string,
    oldString: string,
    newString: string,
): string {
    const diff = generateDiff(oldString, newString);

    const lines: string[] = [];
    lines.push(`--- a/${path}`);
    lines.push(`+++ b/${path}`);

    let oldCount = 0;
    let newCount = 0;
    for (const line of diff) {
        if (line.type === 'context') {
            oldCount++;
            newCount++;
        } else if (line.type === 'remove') {
            oldCount++;
        } else if (line.type === 'add') {
            newCount++;
        }
    }

    const oldStart = oldCount === 0 ? 0 : 1;
    lines.push(`@@ -${oldStart},${oldCount} +1,${newCount} @@`);

    for (const line of diff) {
        if (line.type === 'context') lines.push(` ${line.content}`);
        else if (line.type === 'remove') lines.push(`-${line.content}`);
        else if (line.type === 'add') lines.push(`+${line.content}`);
    }

    return lines.join('\n');
}

export function formatDiff(diff: DiffLine[], maxLines: number = 20): string {
    const lines = diff.slice(0, maxLines);
    const formatted = lines
        .map((line) => {
            const prefix =
                line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
            return `${prefix} ${line.content}`;
        })
        .join('\n');

    if (diff.length > maxLines) {
        return `${formatted}\n... (${diff.length - maxLines} more lines)`;
    }
    return formatted;
}
