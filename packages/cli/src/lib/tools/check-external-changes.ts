import { toolInputSchemas } from '@nightcode/shared';
import { fileWatcher, type FileChangeEvent } from '../file-watcher';

export async function checkExternalChangesTool(input: unknown) {
    const { since, clearAfterQuery } =
        toolInputSchemas.checkExternalChanges.parse(input);

    // Ensure watcher is running
    if (!fileWatcher.isWatching()) {
        fileWatcher.start();
    }

    // Get changes (optionally filtered by timestamp)
    const changes = fileWatcher.getChanges(since);

    // Format the output
    const output = formatChanges(changes, since);

    // Clear changes if requested
    if (clearAfterQuery) {
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
        lines.push(`### ✨ Created (${created.length})`);
        for (const c of created) {
            lines.push(`- ${c.filePath}`);
        }
        lines.push('');
    }

    if (modified.length > 0) {
        lines.push(`### ✏️ Modified (${modified.length})`);
        for (const c of modified) {
            lines.push(`- ${c.filePath}`);
        }
        lines.push('');
    }

    if (deleted.length > 0) {
        lines.push(`### 🗑️ Deleted (${deleted.length})`);
        for (const c of deleted) {
            lines.push(`- ${c.filePath}`);
        }
        lines.push('');
    }

    lines.push(`**Total: ${changes.length} file(s) changed externally**`);
    lines.push('');
    lines.push(
        '⚠️ These changes were made outside of this session. Re-read affected files before editing them.',
    );

    return lines.join('\n');
}
