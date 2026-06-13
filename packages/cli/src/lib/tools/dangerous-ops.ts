export type ConfirmationLevel = 'none' | 'warn' | 'confirm';

export interface ConfirmationRequest {
    id: string;
    toolName: string;
    reason: string;
    details: string;
    accessPath?: string;
    patterns?: string[];
    resolve: (confirmed: boolean, always?: boolean) => void;
}

interface DangerousPattern {
    pattern: RegExp;
    level: ConfirmationLevel;
    reason: string;
}

const DANGEROUS_BASH_PATTERNS: DangerousPattern[] = [
    {
        pattern: /rm\s+(-[rRf]*\s+)*[^\s]+/,
        level: 'confirm',
        reason: 'File deletion',
    },
    {
        pattern: /\/etc\//,
        level: 'confirm',
        reason: 'System file modification',
    },
    {
        pattern: /git\s+push/,
        level: 'confirm',
        reason: 'Push to remote repository',
    },
    {
        pattern: /git\s+reset\s+--hard/,
        level: 'confirm',
        reason: 'Hard reset (loses changes)',
    },
    {
        pattern: /git\s+checkout/,
        level: 'confirm',
        reason: 'Git checkout (switches branch)',
    },
    {
        pattern: /git\s+add\s+(\.|-A|--all|-u)/,
        level: 'confirm',
        reason: 'Stage all changes',
    },
    {
        pattern: /chmod\s+777/,
        level: 'warn',
        reason: 'World-writable permissions',
    },
    {
        pattern: /curl\s+.*\|\s*(ba)?sh/,
        level: 'confirm',
        reason: 'Piping remote script to shell',
    },
    {
        pattern: /wget\s+.*\|\s*(ba)?sh/,
        level: 'confirm',
        reason: 'Piping remote script to shell',
    },
    { pattern: /mkfs/, level: 'confirm', reason: 'Filesystem formatting' },
    { pattern: /dd\s+if=/, level: 'confirm', reason: 'Low-level disk write' },
    {
        pattern: />\s*\/dev\/sd/,
        level: 'confirm',
        reason: 'Direct disk device write',
    },
];

function getBashConfirmationLevel(command: string): ConfirmationLevel {
    let highest: ConfirmationLevel = 'none';

    for (const { pattern, level } of DANGEROUS_BASH_PATTERNS) {
        if (pattern.test(command)) {
            if (level === 'confirm') return 'confirm';
            if (level === 'warn') highest = 'warn';
        }
    }

    return highest;
}

function getBashReason(command: string): string {
    for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
        if (pattern.test(command)) return reason;
    }
    return 'Potentially dangerous command';
}

export function getConfirmationLevel(
    toolName: string,
    input: any,
): {
    level: ConfirmationLevel;
    reason: string;
} {
    if (toolName === 'bash') {
        const command = input?.command ?? '';
        const level = getBashConfirmationLevel(command);
        return { level, reason: getBashReason(command) };
    }

    if (toolName === 'deleteFile') {
        return { level: 'confirm', reason: 'File deletion' };
    }

    if (toolName === 'gitCommit') {
        return { level: 'confirm', reason: 'Git commit (creates a commit)' };
    }

    if (toolName === 'gitBranch') {
        const action = input?.action;
        if (action === 'checkout') {
            return { level: 'confirm', reason: 'Git checkout (switches branch)' };
        }
        if (action === 'delete') {
            return { level: 'confirm', reason: 'Git branch delete' };
        }
    }

    return { level: 'none', reason: '' };
}

export function formatToolInput(toolName: string, input: any): string {
    switch (toolName) {
        case 'bash':
            return `Command: ${input?.command ?? ''}`;
        case 'deleteFile':
            return `File: ${input?.path ?? ''}`;
        case 'gitCommit': {
            const msg = input?.message ?? '';
            const files = input?.files;
            const fileStr = files?.length
                ? ` | Files: ${files.join(', ')}`
                : '';
            return `Message: "${msg}"${fileStr}`;
        }
        case 'gitBranch': {
            const action = input?.action ?? '';
            const branch = input?.name;
            return branch ? `Action: ${action} | Branch: ${branch}` : `Action: ${action}`;
        }
        default:
            return JSON.stringify(input, null, 2);
    }
}

export function getAccessPath(
    toolName: string,
    input: any,
): string | undefined {
    switch (toolName) {
        case 'bash':
            return input?.workingDirectory;
        case 'deleteFile':
        case 'writeFile':
        case 'readFile':
            return input?.path;
        case 'gitBranch':
            return input?.name;
        default:
            return undefined;
    }
}

export function getPatterns(
    toolName: string,
    input: any,
): string[] | undefined {
    switch (toolName) {
        case 'bash':
            return input?.workingDirectory
                ? [`${input.workingDirectory}/*`]
                : undefined;
        case 'deleteFile':
        case 'writeFile':
        case 'readFile':
            return input?.path ? [input.path] : undefined;
        case 'gitCommit':
            return input?.files?.length ? input.files : undefined;
        case 'gitBranch':
            return input?.name ? [`branch:${input.name}`] : undefined;
        default:
            return undefined;
    }
}

let _nextId = 0;

export class ConfirmationManager {
    private _pending = new Map<string, ConfirmationRequest>();
    private _alwaysAllowed = new Set<string>();
    private _listeners = new Set<() => void>();

    get pending(): ReadonlyMap<string, ConfirmationRequest> {
        return this._pending;
    }

    onChange(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _notify() {
        for (const listener of this._listeners) {
            listener();
        }
    }

    request(
        toolName: string,
        reason: string,
        details: string,
        accessPath?: string,
        patterns?: string[],
    ): Promise<boolean> {
        const patternKey = `${toolName}:${accessPath ?? details}`;
        if (this._alwaysAllowed.has(patternKey)) {
            return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
            const id = String(_nextId++);
            this._pending.set(id, {
                id,
                toolName,
                reason,
                details,
                accessPath,
                patterns,
                resolve,
            });
            this._notify();
        });
    }

    confirm(id: string) {
        const req = this._pending.get(id);
        if (req) {
            this._pending.delete(id);
            req.resolve(true, false);
            this._notify();
        }
    }

    confirmAlways(id: string) {
        const req = this._pending.get(id);
        if (req) {
            const patternKey = `${req.toolName}:${req.accessPath ?? req.details}`;
            this._alwaysAllowed.add(patternKey);
            this._pending.delete(id);
            req.resolve(true, true);
            this._notify();
        }
    }

    cancel(id: string) {
        const req = this._pending.get(id);
        if (req) {
            this._pending.delete(id);
            req.resolve(false, false);
            this._notify();
        }
    }
}
