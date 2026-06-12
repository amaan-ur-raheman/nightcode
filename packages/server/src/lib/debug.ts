const DEBUG_ENABLED = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const VERBOSE_ENABLED =
    process.env.DEBUG_VERBOSE === '1' || process.env.DEBUG_VERBOSE === 'true';

class ServerDebugLogger {
    private enabled = DEBUG_ENABLED;
    private verbose = VERBOSE_ENABLED;

    isEnabled(): boolean {
        return this.enabled;
    }

    log(category: string, message: string, data?: unknown): void {
        if (!this.enabled) return;
        const timestamp = new Date().toISOString();
        const extra = this.verbose && data ? ` ${JSON.stringify(data)}` : '';
        console.log(`[${timestamp}] [${category}] ${message}${extra}`);
    }

    warn(category: string, message: string, data?: unknown): void {
        if (!this.enabled) return;
        const timestamp = new Date().toISOString();
        const extra = this.verbose && data ? ` ${JSON.stringify(data)}` : '';
        console.warn(`[${timestamp}] [${category}] WARN: ${message}${extra}`);
    }

    error(category: string, message: string, err?: Error): void {
        if (!this.enabled) return;
        const timestamp = new Date().toISOString();
        const extra = this.verbose && err ? ` ${err.message}` : '';
        console.error(`[${timestamp}] [${category}] ERROR: ${message}${extra}`);
    }
}

export const serverDebug = new ServerDebugLogger();
