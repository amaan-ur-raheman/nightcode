import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { debug } from "./debug";

const ANALYTICS_DIR = join(homedir(), ".nightcode", "analytics");
const ANALYTICS_FILE = join(ANALYTICS_DIR, "tool-usage.json");

interface ToolUsageEntry {
    tool: string;
    count: number;
    totalTime: number;
    errors: number;
    lastUsed: string;
}

interface AnalyticsData {
    sessions: number;
    totalToolCalls: number;
    tools: Record<string, ToolUsageEntry>;
    dailyUsage: Record<string, number>;
}

class ToolAnalytics {
    private data: AnalyticsData = {
        sessions: 0,
        totalToolCalls: 0,
        tools: {},
        dailyUsage: {},
    };
    private loaded = false;
    private dirty = false;

    async load(): Promise<void> {
        if (this.loaded) return;

        try {
            const content = await readFile(ANALYTICS_FILE, "utf-8");
            this.data = JSON.parse(content);
        } catch {
            // No analytics yet
        }

        this.loaded = true;
        this.data.sessions++;
        this.dirty = true;
    }

    async save(): Promise<void> {
        if (!this.dirty) return;

        try {
            await mkdir(ANALYTICS_DIR, { recursive: true });
            await writeFile(ANALYTICS_FILE, JSON.stringify(this.data, null, 2), "utf-8");
            this.dirty = false;
        } catch {
            // Save failure should never crash the app
        }
    }

    async recordToolCall(tool: string, duration: number, success: boolean): Promise<void> {
        await this.load();

        if (!this.data.tools[tool]) {
            this.data.tools[tool] = {
                tool,
                count: 0,
                totalTime: 0,
                errors: 0,
                lastUsed: new Date().toISOString(),
            };
        }

        const entry = this.data.tools[tool];
        entry.count++;
        entry.totalTime += duration;
        entry.lastUsed = new Date().toISOString();

        if (!success) {
            entry.errors++;
        }

        this.data.totalToolCalls++;

        const today = new Date().toISOString().split("T")[0] ?? "";
        this.data.dailyUsage[today] = (this.data.dailyUsage[today] || 0) + 1;

        this.dirty = true;

        if (entry.count % 10 === 0) {
            await this.save();
        }
    }

    async getStats(): Promise<{
        totalCalls: number;
        topTools: Array<{ tool: string; count: number; avgTime: number; errorRate: number }>;
        dailyAverage: number;
        sessions: number;
    }> {
        await this.load();

        const topTools = Object.values(this.data.tools)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .map((entry) => ({
                tool: entry.tool,
                count: entry.count,
                avgTime: Math.round(entry.totalTime / entry.count),
                errorRate: entry.count > 0 ? Math.round((entry.errors / entry.count) * 100) : 0,
            }));

        const dailyValues = Object.values(this.data.dailyUsage);
        const dailyAverage =
            dailyValues.length > 0
                ? Math.round(dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length)
                : 0;

        return {
            totalCalls: this.data.totalToolCalls,
            topTools,
            dailyAverage,
            sessions: this.data.sessions,
        };
    }

    async clearStats(): Promise<void> {
        this.data = {
            sessions: 0,
            totalToolCalls: 0,
            tools: {},
            dailyUsage: {},
        };
        this.dirty = true;
        await this.save();
        debug.log("analytics", "Cleared tool analytics");
    }
}

export const toolAnalytics = new ToolAnalytics();
