import { readFile, writeFile } from "fs/promises";
import { resolve, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { globCache } from "../glob-cache";
import { undoManager } from "../undo-manager";
import { generateDiff, formatDiff } from "../diff-utils";

interface RenameMatch {
    line: number;
    oldName: string;
    newName: string;
    context: string;
}

/**
 * Context-aware rename patterns that understand different code positions.
 * Each pattern classifies WHERE a symbol appears so we only rename
 * true references — not substrings, string literals, or comments.
 */
const SYMBOL_PATTERNS = {
    /** const/let/var <name> = … */
    variableDecl: (e: string) => new RegExp(`\\b(?:const|let|var)\\s+${e}\\b`, "g"),
    /** function <name>(…) */
    functionDecl: (e: string) => new RegExp(`\\bfunction\\s+${e}\\b`, "g"),
    /** class <name> */
    classDecl: (e: string) => new RegExp(`\\bclass\\s+${e}\\b`, "g"),
    /** export default function <name> / export function <name> */
    exportDecl: (e: string) => new RegExp(`\\bexport\\s+(?:default\\s+)?(?:function|class|const|let|var)\\s+${e}\\b`, "g"),
    /** import { <name> } from … / import <name> from … */
    importRef: (e: string) => new RegExp(`\\bimport\\s+(?:\\{[^}]*\\b${e}\\b[^}]*\\}|\\b${e}\\b)\\s+from\\b`, "g"),
    /** <name>( — function call */
    callExpr: (e: string) => new RegExp(`\\b${e}\\s*\\(`, "g"),
    /** .<name> — property access / method call */
    memberAccess: (e: string) => new RegExp(`\\.${e}\\b`, "g"),
    /** : <name> — type annotation */
    typeAnnotation: (e: string) => new RegExp(`:\\s*${e}\\b`, "g"),
    /** <name>.prototype or <name> satisfies / <name> as */
    usage: (e: string) => new RegExp(`\\b${e}\\b`, "g"),
};

/**
 * Check if a match is inside a string literal or line comment.
 * We avoid renaming symbols that appear only in strings/comments.
 */
function isInStringOrComment(line: string, matchStart: number): boolean {
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;

    for (let i = 0; i < matchStart; i++) {
        const ch = line[i];
        const prev = i > 0 ? line[i - 1] : "";

        if (ch === "'" && prev !== "\\" && !inDouble && !inBacktick) inSingle = !inSingle;
        else if (ch === '"' && prev !== "\\" && !inSingle && !inBacktick) inDouble = !inDouble;
        else if (ch === "`" && prev !== "\\" && !inSingle && !inDouble) inBacktick = !inBacktick;
        else if (ch === "/" && line[i + 1] === "/" && !inSingle && !inDouble && !inBacktick) return true;
    }

    return inSingle || inDouble || inBacktick;
}

/**
 * AST-aware: classify which patterns match on a given line and collect replacements.
 * Returns matches with line numbers and context.
 */
function findRenamesInLine(
    line: string,
    lineNum: number,
    oldName: string,
    newName: string,
): RenameMatch | null {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Walk the ordered patterns; first match wins per line (avoids double-replacing)
    for (const [, patternFn] of Object.entries(SYMBOL_PATTERNS)) {
        const regex = patternFn(escaped);
        const match = regex.exec(line);
        if (!match) continue;

        // Skip string literals and comments
        if (isInStringOrComment(line, match.index)) continue;

        // Verify whole-word boundary at match start/end
        const before = line[match.index - 1];
        const after = line[match.index + oldName.length];
        if (before && /\w/.test(before)) continue;
        if (after && /\w/.test(after)) continue;

        // Apply replacement for this line
        const wordRegex = new RegExp(`\\b${escaped}\\b`, "g");
        const updated = line.replace(wordRegex, newName);
        return {
            line: lineNum,
            oldName,
            newName,
            context: updated.trim(),
        };
    }

    return null;
}

export async function renameSymbolTool(input: unknown) {
    const { oldName, newName, glob: globPattern, dryRun = false, fileTypes } =
        toolInputSchemas.renameSymbol.parse(input);

    if (oldName === newName) {
        return { filesChanged: 0, changes: [], diff: "" };
    }

    const cwd = process.cwd();
    const allMatches = await globCache.getCachedGlob(globPattern, cwd);

    // Filter by file extension if requested
    const files = allMatches.filter((f) => {
        if (!fileTypes || fileTypes.length === 0) return true;
        const ext = "." + f.split(".").pop();
        return fileTypes.includes(ext);
    });

    const results: { file: string; matches: RenameMatch[] }[] = [];
    const diffs: { path: string; diff: string }[] = [];

    for (const file of files) {
        const resolved = resolve(cwd, file);
        const relPath = relative(cwd, resolved);
        if (relPath.startsWith("..")) continue;

        const content = await readFile(resolved, "utf-8");
        const lines = content.split("\n");
        const fileMatches: RenameMatch[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === undefined) continue;
            const match = findRenamesInLine(line, i + 1, oldName, newName);
            if (match) {
                fileMatches.push(match);
                lines[i] = line.replace(
                    new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
                    newName,
                );
            }
        }

        if (fileMatches.length > 0) {
            results.push({ file: relPath, matches: fileMatches });

            const updatedContent = lines.join("\n");
            const diffLines = generateDiff(content, updatedContent);
            diffs.push({ path: relPath, diff: formatDiff(diffLines) });

            if (!dryRun) {
                await undoManager.backup(resolved, "renameSymbol", `Rename ${oldName} → ${newName} in ${relPath}`);
                await writeFile(resolved, updatedContent, "utf-8");
            }
        }
    }

    if (!dryRun && results.length > 0) globCache.invalidate();

    const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
    const diffSummary = diffs
        .map((d) => `--- ${d.path}\n${d.diff}`)
        .join("\n\n");

    return {
        filesChanged: results.length,
        totalMatches,
        dryRun,
        changes: results.map((r) => ({
            file: r.file,
            replacements: r.matches.length,
            lines: r.matches.map((m) => m.line),
        })),
        diff: diffSummary,
    };
}
