import { z } from "zod";
import { tool } from "ai";

const MAX_BODY = 20_000;
const DEFAULT_TIMEOUT = 15_000;

const BLOCKED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.",
    "10.",
    "192.168.",
    "[::1]",
    ".local",
    ".internal",
    ".lan",
];

// RFC 1918: 172.16.0.0/12 covers 172.16.x.x – 172.31.x.x
const BLOCKED_172 = /^172\.(1[6-9]|2\d|3[01])\./;

function isAllowed(url: string): { allowed: boolean; reason?: string } {
    try {
        const parsed = new URL(url);

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return { allowed: false, reason: `Scheme ${parsed.protocol} is not allowed.` };
        }

        const host = parsed.hostname.toLowerCase();
        const isInternal =
            BLOCKED_HOSTS.some((block) => host === block || host.startsWith(block) || host.endsWith(block)) ||
            BLOCKED_172.test(host);

        if (isInternal) {
            return { allowed: false, reason: "Requests to internal/private addresses are blocked." };
        }

        return { allowed: true };
    } catch {
        return { allowed: false, reason: "Invalid URL." };
    }
}

export function createWebFetchTool() {
    return tool({
        description:
            "Fetch a remote URL and return its body as text. Internal/private addresses are blocked.",
        inputSchema: z.object({
            url: z.string().url().describe("Full URL to fetch"),
            headers: z
                .record(z.string(), z.string())
                .describe("Optional HTTP request headers")
                .optional(),
        }),
        execute: async ({ url, headers }) => {
            const check = isAllowed(url);
            if (!check.allowed) {
                return { error: check.reason };
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

            try {
                const response = await fetch(url, {
                    headers: headers as Record<string, string> | undefined,
                    signal: controller.signal,
                });

                clearTimeout(timer);

                if (!response.ok) {
                    return { error: `HTTP ${response.status}: ${response.statusText}` };
                }

                const body = await response.text();
                const truncated = body.length > MAX_BODY;

                return {
                    url,
                    status: response.status,
                    contentType: response.headers.get("content-type"),
                    body: truncated ? body.slice(0, MAX_BODY) + "\n...(truncated)" : body,
                    ...(truncated ? { truncated: true, totalLength: body.length } : {}),
                };
            } catch (err) {
                clearTimeout(timer);
                const message = err instanceof Error ? err.message : String(err);
                return { error: message.includes("aborted") ? `Request timed out after ${DEFAULT_TIMEOUT}ms` : `Failed to fetch URL: ${message}` };
            }
        },
    });
}
