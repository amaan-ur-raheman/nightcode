// ─── Command Safety (merged from bash-safety.ts) ────────────────────────────

const BLOCKED_COMMANDS = [
    'rm -rf /',
    'rm -rf /*',
    'rm -rf ~',
    'rm -rf ~/',
    'mkfs',
    'dd if=',
    ':(){',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'init 0',
    'init 6',
];

const DANGEROUS_FLAGS = [
    '--force',
    '-f',
    '--no-preserve-root',
    '--recursive',
    '-r',
];

const SUSPICIOUS_PATTERNS: RegExp[] = [
    /rm\s+(-[rRf]+\s+)*[/~]/,
    />\s*\/dev\/sd/,
    /chmod\s+777/,
    /curl\s+.*\|\s*sh/,
    /wget\s+.*\|\s*sh/,
];

export interface SafetyCheckResult {
    safe: boolean;
    blocked: boolean;
    warning?: string;
}

export function checkCommandSafety(command: string): SafetyCheckResult {
    for (const blocked of BLOCKED_COMMANDS) {
        if (command.includes(blocked)) {
            return {
                safe: false,
                blocked: true,
                warning: `Blocked: command contains '${blocked}'`,
            };
        }
    }

    const words = command.split(/\s+/);
    for (const flag of DANGEROUS_FLAGS) {
        if (words.includes(flag)) {
            return {
                safe: true,
                blocked: false,
                warning: `Warning: '${flag}' flag detected`,
            };
        }
    }

    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(command)) {
            return {
                safe: true,
                blocked: false,
                warning: 'Warning: suspicious pattern detected',
            };
        }
    }

    return { safe: true, blocked: false };
}

// ─── Confirmation System ────────────────────────────────────────────────────

export type ConfirmationLevel = 'none' | 'warn' | 'confirm';

export interface ConfirmationRequest {
    id: string;
    toolName: string;
    reason: string;
    details: string;
    accessPath?: string;
    patterns?: string[];
    resolve: (confirmed: boolean, always?: boolean) => void;
    diff?: string;
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

import { getAutonomyLevel } from '../settings';

export function getConfirmationLevel(
    toolName: string,
    input: any,
): {
    level: ConfirmationLevel;
    reason: string;
} {
    const autonomy = getAutonomyLevel();
    if (autonomy === 'full') {
        return { level: 'none', reason: '' };
    }

    if (toolName === 'run_command') {
        const action = typeof input?.action === 'string' ? input.action : '';
        if (action === 'bash') {
            const command = input?.command ?? '';
            const level = getBashConfirmationLevel(command);
            return { level, reason: getBashReason(command) };
        }
        if (action === 'code_analysis' || action === 'env') {
            return { level: 'confirm', reason: `run_command (${action})` };
        }
    }

    if (toolName === 'git_operation') {
        const action = typeof input?.action === 'string' ? input.action : '';
        if (action === 'commit') {
            if (autonomy === 'balanced') {
                return { level: 'none', reason: '' };
            }
            return {
                level: 'confirm',
                reason: 'Git commit (creates a commit)',
            };
        }
        if (action === 'branch') {
            const branchAction =
                typeof input?.branchAction === 'string'
                    ? input.branchAction
                    : '';
            if (branchAction === 'checkout') {
                if (autonomy === 'balanced') {
                    return { level: 'none', reason: '' };
                }
                return {
                    level: 'confirm',
                    reason: 'Git checkout (switches branch)',
                };
            }
            if (branchAction === 'delete') {
                return { level: 'confirm', reason: 'Git branch delete' };
            }
        }
    }

    return { level: 'none', reason: '' };
}

export function formatToolInput(toolName: string, input: any): string {
    const getAction = (): string =>
        typeof input?.action === 'string' ? input.action : '';

    switch (toolName) {
        case 'run_command': {
            const act = getAction();
            if (act === 'bash') {
                return `Command: ${input?.command ?? ''}`;
            }
            return `run_command (${act})`;
        }
        case 'edit_file': {
            const act = getAction();
            if (act === 'delete') {
                return `File: ${input?.path ?? ''}`;
            }
            if (act === 'move') {
                return `Move: ${input?.path ?? ''} → ${input?.destPath ?? ''}`;
            }
            return `Edit: ${input?.path ?? ''}`;
        }
        case 'write_file':
            return `Write: ${input?.path ?? ''}`;
        case 'git_operation': {
            const act = getAction();
            if (act === 'commit') {
                const msg = input?.message ?? '';
                const files = input?.files;
                const fileStr = files?.length
                    ? ` | Files: ${files.join(', ')}`
                    : '';
                return `Message: "${msg}"${fileStr}`;
            }
            if (act === 'branch') {
                const branchAction = input?.branchAction ?? '';
                const branch = input?.name;
                return branch
                    ? `Action: ${branchAction} | Branch: ${branch}`
                    : `Action: ${branchAction}`;
            }
            return `git_operation (${act})`;
        }
        case 'workspace_memory':
            return `Key: ${input?.key ?? ''}`;
        case 'manage_keychain':
            return `Key: ${input?.key ?? ''}`;
        case 'knowledge_graph':
            return `Action: ${getAction()}`;
        default:
            return JSON.stringify(input, null, 2);
    }
}

export function getAccessPath(
    toolName: string,
    input: any,
): string | undefined {
    switch (toolName) {
        case 'run_command':
            return input?.workingDirectory;
        case 'edit_file':
        case 'write_file':
        case 'read_file':
            return input?.path;
        case 'git_operation':
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
        case 'run_command':
            return input?.workingDirectory
                ? [`${input.workingDirectory}/*`]
                : undefined;
        case 'edit_file':
        case 'write_file':
        case 'read_file':
            return input?.path ? [input.path] : undefined;
        case 'git_operation':
            if (input?.files?.length) return input.files;
            if (input?.name) return [`branch:${input.name}`];
            return undefined;
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
        diff?: string,
        timeoutMs = 60_000, // 60 seconds
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
                diff,
            });
            this._notify();

            // Auto-reject after timeout to prevent hanging
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    resolve(false);
                    this._notify();
                }
            }, timeoutMs);
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
