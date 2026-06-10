const BLOCKED_COMMANDS = [
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf ~/",
    "mkfs",
    "dd if=",
    ":(){",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "init 0",
    "init 6",
];

const DANGEROUS_FLAGS = ["--force", "-f", "--no-preserve-root", "--recursive", "-r"];

const SUSPICIOUS_PATTERNS: RegExp[] = [
    /rm\s+(-[rRf]+\s+)*[\/~]/,
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
                warning: "Warning: suspicious pattern detected",
            };
        }
    }

    return { safe: true, blocked: false };
}
