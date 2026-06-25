import { relative } from 'path';
import { toolInputSchemas } from '@nightcode/shared';
import { stat, readFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { basename } from 'path';
import { MAX_FILE_SIZE, readCachedFile, resolveInsideCwd } from './utils';
import { fileWatcher, type FileChangeEvent } from '../file-watcher';

export async function readFileTool(input: unknown) {
    const {
        path,
        offset,
        limit,
        infoOnly,
        checkExternalChanges,
        externalChangesSince,
        clearExternalChanges,
    } = toolInputSchemas.read_file.parse(input);

    if (checkExternalChanges) {
        // Ensure watcher is running
        if (!fileWatcher.isWatching()) {
            fileWatcher.start();
        }
        const changes = fileWatcher.getChanges(externalChangesSince);
        const output = formatChanges(changes, externalChangesSince);
        if (clearExternalChanges) {
            fileWatcher.clearChanges();
        }
        return {
            success: true as const,
            changeCount: changes.length,
            changes: changes.map((c) => ({
                file: c.filePath,
                type: c.changeType,
                timestamp: c.timestamp,
            })),
            output,
        };
    }

    const { cwd, resolved } = resolveInsideCwd(path);

    if (infoOnly) {
        const info = await stat(resolved);

        if (!info.isFile() && !info.isDirectory())
            return { error: 'Path is neither a file nor a directory' };

        const result: Record<string, unknown> = {
            path: relative(cwd, resolved) || '.',
            name: basename(resolved) || '.',
            isDirectory: info.isDirectory(),
            size: info.size,
            modified: info.mtime.toISOString(),
        };

        if (info.isFile()) {
            let newlineCount = 0;
            if (info.size <= 1024 * 1024) {
                const content = await readFile(resolved, 'utf-8');
                for (let i = 0; i < content.length; i++) {
                    if (content.charCodeAt(i) === 0x0a) newlineCount++;
                }
            } else {
                let seenAnyByte = false,
                    lastByteWasNewline = false;
                const stream = createReadStream(resolved, {
                    highWaterMark: 64 * 1024,
                });
                for await (const chunk of stream) {
                    const buf = chunk as Buffer;
                    for (let i = 0; i < buf.length; i++) {
                        seenAnyByte = true;
                        lastByteWasNewline = buf[i] === 0x0a;
                        if (lastByteWasNewline) newlineCount++;
                    }
                    if (buf.length > 0)
                        lastByteWasNewline = buf[buf.length - 1] === 0x0a;
                }
                result.lineCount =
                    newlineCount + (seenAnyByte && !lastByteWasNewline ? 1 : 0);
                return result;
            }
            result.lineCount =
                newlineCount + (info.size > 0 && newlineCount === 0 ? 1 : 0);
        }
        return result;
    }

    const content = await readCachedFile(resolved);
    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const totalBytes = Buffer.byteLength(content, 'utf-8');

    if (offset != null || limit != null) {
        const start = Math.max(1, offset ?? 1);
        const effectiveLimit =
            limit != null
                ? Math.max(0, limit)
                : Math.max(1, totalLines - start + 1);
        const end = Math.min(totalLines, start + effectiveLimit - 1);
        const slicedLines = allLines.slice(start - 1, end);
        const sliced = slicedLines.join('\n');
        if (sliced.length > MAX_FILE_SIZE) {
            return {
                content: sliced.slice(0, MAX_FILE_SIZE),
                path: relative(cwd, resolved),
                offset: start,
                limit: effectiveLimit,
                totalLines,
                totalBytes,
                displayedLines: slicedLines.length,
                truncated: true,
                totalLength: sliced.length,
            };
        }
        return {
            content: sliced,
            path: relative(cwd, resolved),
            offset: start,
            limit: effectiveLimit,
            totalLines,
            totalBytes,
            displayedLines: slicedLines.length,
        };
    }

    if (content.length > MAX_FILE_SIZE) {
        return {
            content: content.slice(0, MAX_FILE_SIZE),
            path: relative(cwd, resolved),
            truncated: true,
            totalLength: content.length,
            totalLines,
            totalBytes,
        };
    }

    return { content, path: relative(cwd, resolved), totalLines, totalBytes };
}

function formatChanges(changes: FileChangeEvent[], since?: number): string {
    if (changes.length === 0) {
        if (since) {
            return `No external file changes detected since ${new Date(since).toLocaleTimeString()}.`;
        }
        return 'No external file changes detected.';
    }

    const lines: string[] = [];

    if (since) {
        lines.push(
            `## External Changes Since ${new Date(since).toLocaleTimeString()}`,
        );
    } else {
        lines.push('## External File Changes');
    }

    lines.push('');

    // Group by change type
    const created = changes.filter((c) => c.changeType === 'created');
    const modified = changes.filter((c) => c.changeType === 'modified');
    const deleted = changes.filter((c) => c.changeType === 'deleted');

    if (created.length > 0) {
        lines.push(`### [Created] (${created.length})`);
        for (const c of created) {
            lines.push(`- ${c.filePath}`);
        }
        lines.push('');
    }

    if (modified.length > 0) {
        lines.push(`### [Modified] (${modified.length})`);
        for (const c of modified) {
            lines.push(`- ${c.filePath}`);
        }
        lines.push('');
    }

    if (deleted.length > 0) {
        lines.push(`### [Deleted] (${deleted.length})`);
        for (const c of deleted) {
            lines.push(`- ${c.filePath}`);
        }
        lines.push('');
    }

    lines.push(`**Total: ${changes.length} file(s) changed externally**`);
    lines.push('');
    lines.push(
        '[WARNING] These changes were made outside of this session. Re-read affected files before editing them.',
    );

    return lines.join('\n');
}
