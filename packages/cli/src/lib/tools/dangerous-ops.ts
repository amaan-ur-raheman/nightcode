export type ConfirmationLevel = "none" | "warn" | "confirm";

export interface ConfirmationRequest {
    id: string;
    toolName: string;
    reason: string;
    details: string;
    resolve: (confirmed: boolean) => void;
}

interface DangerousPattern {
    pattern: RegExp;
    level: ConfirmationLevel;
    reason: string;
}

const DANGEROUS_BASH_PATTERNS: DangerousPattern[] = [
    { pattern: /rm\s+(-[rRf]*\s+)*[^\s]+/, level: "confirm", reason: "File deletion" },
    { pattern: /\/etc\//, level: "confirm", reason: "System file modification" },
    { pattern: /git\s+push\s+--force/, level: "confirm", reason: "Force push to remote" },
    { pattern: /git\s+reset\s+--hard/, level: "confirm", reason: "Hard reset (loses changes)" },
    { pattern: /chmod\s+777/, level: "warn", reason: "World-writable permissions" },
    { pattern: /curl\s+.*\|\s*(ba)?sh/, level: "confirm", reason: "Piping remote script to shell" },
    { pattern: /wget\s+.*\|\s*(ba)?sh/, level: "confirm", reason: "Piping remote script to shell" },
    { pattern: /mkfs/, level: "confirm", reason: "Filesystem formatting" },
    { pattern: /dd\s+if=/, level: "confirm", reason: "Low-level disk write" },
    { pattern: />\s*\/dev\/sd/, level: "confirm", reason: "Direct disk device write" },
];

function getBashConfirmationLevel(command: string): ConfirmationLevel {
    let highest: ConfirmationLevel = "none";

    for (const { pattern, level } of DANGEROUS_BASH_PATTERNS) {
        if (pattern.test(command)) {
            if (level === "confirm") return "confirm";
            if (level === "warn") highest = "warn";
        }
    }

    return highest;
}

function getBashReason(command: string): string {
    for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
        if (pattern.test(command)) return reason;
    }
    return "Potentially dangerous command";
}

export function getConfirmationLevel(toolName: string, input: any): {
    level: ConfirmationLevel;
    reason: string;
} {
    if (toolName === "bash") {
        const command = input?.command ?? "";
        const level = getBashConfirmationLevel(command);
        return { level, reason: getBashReason(command) };
    }

    if (toolName === "deleteFile") {
        return { level: "confirm", reason: "File deletion" };
    }

    return { level: "none", reason: "" };
}

export function formatToolInput(toolName: string, input: any): string {
    switch (toolName) {
        case "bash":
            return `Command: ${input?.command ?? ""}`;
        case "deleteFile":
            return `File: ${input?.path ?? ""}`;
        default:
            return JSON.stringify(input, null, 2);
    }
}

let _nextId = 0;

export class ConfirmationManager {
    private _pending = new Map<string, ConfirmationRequest>();
    private _listener: (() => void) | null = null;

    get pending(): ReadonlyMap<string, ConfirmationRequest> {
        return this._pending;
    }

    onChange(listener: () => void): () => void {
        this._listener = listener;
        return () => { this._listener = null; };
    }

    private _notify() {
        this._listener?.();
    }

    request(toolName: string, reason: string, details: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const id = String(_nextId++);
            this._pending.set(id, { id, toolName, reason, details, resolve });
            this._notify();
        });
    }

    confirm(id: string) {
        const req = this._pending.get(id);
        if (req) {
            this._pending.delete(id);
            req.resolve(true);
            this._notify();
        }
    }

    cancel(id: string) {
        const req = this._pending.get(id);
        if (req) {
            this._pending.delete(id);
            req.resolve(false);
            this._notify();
        }
    }
}
