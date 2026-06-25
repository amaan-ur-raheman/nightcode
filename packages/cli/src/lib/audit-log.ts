import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { safeStringify } from './safe-json';

const AUDIT_DIR = join(homedir(), '.nightcode', 'logs');
const AUDIT_FILE = join(AUDIT_DIR, 'audit.jsonl');

// Patterns for values that should be redacted from logs
const SENSITIVE_PATTERNS = [
    /api[_-]?key/i,
    /password/i,
    /secret/i,
    /token/i,
    /authorization/i,
    /bearer/i,
    /credential/i,
];

function redactSensitive(
    value: unknown,
    seen = new WeakSet<object>(),
): unknown {
    if (value == null) return value;
    if (typeof value === 'string') {
        // Redact strings that look like they contain secrets
        if (SENSITIVE_PATTERNS.some((p) => p.test(value)) && value.length > 8) {
            return '[REDACTED]';
        }
        return value;
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        return value.map((item) => redactSensitive(item, seen));
    }
    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
            if (SENSITIVE_PATTERNS.some((p) => p.test(key))) {
                result[key] = '[REDACTED]';
            } else {
                result[key] = redactSensitive(val, seen);
            }
        }
        return result;
    }
    return value;
}

function truncateString(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return (
        str.slice(0, maxLen) + `... [truncated ${str.length - maxLen} chars]`
    );
}

export interface AuditEntry {
    timestamp: string;
    sessionId: string;
    tool: string;
    input: unknown;
    output?: string;
    error?: string;
    duration: number;
    success: boolean;
}

class AuditLogger {
    private readonly logger = console;
    private enabled = true;
    private buffer: AuditEntry[] = [];
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private readonly FLUSH_INTERVAL = 1000;
    private readonly BUFFER_LIMIT = 100;
    private readonly MAX_OUTPUT_LEN = 1000;

    private ensureTimer(): void {
        if (this.flushTimer) return;
        this.flushTimer = setInterval(() => {
            this.flush().catch((err) => {
                this.logger.error('Audit flush failed', err);
            });
        }, this.FLUSH_INTERVAL);
    }

    async log(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
        if (!this.enabled) return;

        this.ensureTimer();

        const fullEntry: AuditEntry = {
            ...entry,
            timestamp: new Date().toISOString(),
            input: redactSensitive(entry.input),
            output: entry.output
                ? truncateString(entry.output, this.MAX_OUTPUT_LEN)
                : undefined,
        };

        this.buffer.push(fullEntry);

        if (this.buffer.length >= this.BUFFER_LIMIT) {
            await this.flush().catch((err) => {
                this.logger.error('Audit flush failed', err);
            });
        }
    }

    async flush(): Promise<void> {
        if (this.buffer.length === 0) return;

        const toFlush = this.buffer.splice(0, this.buffer.length);

        try {
            await mkdir(AUDIT_DIR, { recursive: true });
            const lines =
                toFlush.map((e) => JSON.stringify(e)).join('\n') + '\n';
            await appendFile(AUDIT_FILE, lines, 'utf-8');
        } catch (error) {
            // Put entries back on failure so they aren't lost
            this.buffer.unshift(...toFlush);
            throw error;
        }
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    async getRecent(count: number = 50): Promise<AuditEntry[]> {
        try {
            if (!existsSync(AUDIT_FILE)) return [];
            const content = await readFile(AUDIT_FILE, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            return lines.slice(-count).map((l) => JSON.parse(l) as AuditEntry);
        } catch {
            return [];
        }
    }

    async search(query: string): Promise<AuditEntry[]> {
        const entries = await this.getRecent(1000);
        const lower = query.toLowerCase();
        return entries.filter(
            (e) =>
                e.tool.toLowerCase().includes(lower) ||
                safeStringify(e.input).toLowerCase().includes(lower) ||
                (e.error && e.error.toLowerCase().includes(lower)),
        );
    }

    async rotateLogs(retentionDays: number): Promise<void> {
        try {
            if (!existsSync(AUDIT_FILE)) return;

            const content = await readFile(AUDIT_FILE, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            const cutoff = new Date(
                Date.now() - retentionDays * 24 * 60 * 60 * 1000,
            );

            const filtered = lines.filter((l) => {
                try {
                    const entry = JSON.parse(l) as AuditEntry;
                    return new Date(entry.timestamp) > cutoff;
                } catch {
                    return false;
                }
            });

            await mkdir(AUDIT_DIR, { recursive: true });
            const output =
                filtered.length > 0 ? filtered.join('\n') + '\n' : '';
            await writeFile(AUDIT_FILE, output, 'utf-8');
        } catch {
            // Rotation is best-effort
        }
    }

    async destroy(): Promise<void> {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        // Flush remaining entries
        await this.flush().catch((err) =>
            this.logger.error('Final audit flush failed', err),
        );
    }
}

export const auditLog = new AuditLogger();
