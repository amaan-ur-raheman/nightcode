import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DEBUG_DIR = join(homedir(), ".nightcode", "logs");
const DEBUG_FILE = join(DEBUG_DIR, "debug.log");
const DEFAULT_RETENTION_DAYS = 7;

class DebugLogger {
    private enabled = false;
    private verbose = false;
    private queue: Record<string, unknown>[] = [];
    private writing = false;

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setVerbose(verbose: boolean): void {
        this.verbose = verbose;
    }

    isVerbose(): boolean {
        return this.verbose;
    }

    toggleEnabled(): boolean {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    log(category: string, message: string, data?: unknown): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level: "LOG",
            category,
            message,
            data: this.verbose ? data : undefined,
        };

        console.log(`[${timestamp}] [${category}] ${message}`);
        this.writeToFile(entry).catch(() => {});
    }

    warn(category: string, message: string, data?: unknown): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level: "WARN",
            category,
            message,
            data: this.verbose ? data : undefined,
        };

        console.warn(`[${timestamp}] [${category}] WARN: ${message}`);
        this.writeToFile(entry).catch(() => {});
    }

    error(category: string, message: string, error?: Error): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level: "ERROR",
            category,
            message,
            error: error?.message,
            stack: this.verbose ? error?.stack : undefined,
        };

        console.error(`[${timestamp}] [${category}] ERROR: ${message}`);
        this.writeToFile(entry).catch(() => {});
    }

    private async writeToFile(entry: Record<string, unknown>): Promise<void> {
        this.queue.push(entry);
        await this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.writing) return;
        this.writing = true;

        try {
            while (this.queue.length > 0) {
                const entry = this.queue.shift();
                if (!entry) continue;

                try {
                    await mkdir(DEBUG_DIR, { recursive: true });
                    await appendFile(DEBUG_FILE, JSON.stringify(entry) + "\n", "utf-8");
                } catch {
                    // File write failure should never crash the app
                }
            }
        } finally {
            this.writing = false;
        }
    }

    async getLogs(count: number = 100): Promise<Record<string, unknown>[]> {
        try {
            const content = await readFile(DEBUG_FILE, "utf-8");
            const lines = content.trim().split("\n").filter(Boolean);
            return lines.slice(-count).map((l) => JSON.parse(l));
        } catch {
            return [];
        }
    }

    async clearLogs(): Promise<void> {
        try {
            await writeFile(DEBUG_FILE, "", "utf-8");
        } catch {
            // ignore
        }
    }

    async rotateLogs(retentionDays: number = DEFAULT_RETENTION_DAYS): Promise<void> {
        try {
            const logs = await this.getLogs(10000);
            const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
            const filtered = logs.filter((l) => {
                const ts = l.timestamp;
                if (typeof ts !== "string" && typeof ts !== "number") {
                    return false;
                }
                const parsed = typeof ts === "number" ? ts : Date.parse(ts);
                if (Number.isNaN(parsed)) {
                    return false;
                }
                return new Date(parsed) > cutoff;
            });

            await mkdir(DEBUG_DIR, { recursive: true });
            const content =
                filtered.map((l) => JSON.stringify(l)).join("\n") + "\n";
            await writeFile(DEBUG_FILE, content, "utf-8");
        } catch {
            // ignore
        }
    }

    async getRecentLogs(count: number = 50): Promise<string> {
        const logs = await this.getLogs(count);
        if (logs.length === 0) return "No debug logs available.";

        return logs
            .map((entry) => {
                const ts = entry.timestamp as string;
                const level = (entry.level as string) ?? "LOG";
                const cat = entry.category as string;
                const msg = entry.message as string;
                const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
                const errMsg = entry.error ? ` error=${entry.error}` : "";
                return `[${ts}] [${level}] [${cat}] ${msg}${errMsg}${data}`;
            })
            .join("\n");
    }
}

export const debug = new DebugLogger();
