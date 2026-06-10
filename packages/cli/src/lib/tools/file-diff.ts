import { readFile } from "fs/promises";
import { MAX_DIFF } from "./utils";

/**
 * Generate a simple unified diff preview showing what changed in a file.
 * Returns a truncated string suitable for tool output.
 */
export async function generateDiffPreview(
    resolvedPath: string,
    newContent: string,
): Promise<string> {
    try {
        const oldContent = await readFile(resolvedPath, "utf-8");
        if (oldContent === newContent) return "(no changes)";

        const oldLines = oldContent.split("\n");
        const newLines = newContent.split("\n");
        const diff = unifiedDiff(oldLines, newLines, resolvedPath);
        return truncateDiff(diff);
    } catch {
        return "(new file)";
    }
}

/**
 * Generate a simple unified diff between two line arrays.
 */
function unifiedDiff(
    oldLines: string[],
    newLines: string[],
    label: string,
): string {
    const result: string[] = [`--- a/${label}`, `+++ b/${label}`];

    // Simple line-by-line diff
    const maxLen = Math.max(oldLines.length, newLines.length);
    let i = 0;

    while (i < maxLen) {
        if (oldLines[i] === newLines[i]) {
            i++;
            continue;
        }

        // Find the range of changed lines
        let oldEnd = i;
        let newEnd = i;
        while (
            oldEnd < oldLines.length &&
            newEnd < newLines.length &&
            oldLines[oldEnd] !== newLines[newEnd]
        ) {
            oldEnd++;
            newEnd++;
        }

        const oldCount = oldEnd - i;
        const newCount = newEnd - i;
        result.push(`@@ -${i + 1},${oldCount} +${i + 1},${newCount} @@`);

        for (let j = i; j < oldEnd; j++) {
            result.push(`-${oldLines[j]}`);
        }
        for (let j = i; j < newEnd; j++) {
            result.push(`+${newLines[j]}`);
        }

        i = Math.max(oldEnd, newEnd);
    }

    return result.join("\n");
}

function truncateDiff(diff: string): string {
    if (diff.length <= MAX_DIFF) return diff;
    const half = MAX_DIFF / 2;
    return (
        diff.slice(0, half) +
        `\n... (truncated, ${diff.length} total chars) ...\n` +
        diff.slice(-half)
    );
}
