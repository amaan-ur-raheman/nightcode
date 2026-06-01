import { z } from "zod";
import { tool } from "ai";
import { dns } from "bun";

const MAX_BODY = 20_000;
const DEFAULT_TIMEOUT = 15_000;
const MAX_REDIRECTS = 5;

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

// Reject non-standard IP encodings (octal octets, hex, bare integers)
const STANDARD_IP = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/;

function isPrivateIP(ip: string): boolean {
    const h = ip.replace(/^\[|\]$/g, "").toLowerCase();
    // IPv6
    if (h.includes(":")) {
        return h === "::1" ||
            h.startsWith("fc") || h.startsWith("fd") || // ULA fc00::/7
            h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb"); // link-local fe80::/10
    }
    // IPv4
    return (
        h === "127.0.0.1" ||
        h.startsWith("127.") ||
        h.startsWith("10.") ||
        h.startsWith("192.168.") ||
        h.startsWith("169.254.") ||
        h === "0.0.0.0" ||
        BLOCKED_172.test(h)
    );
}

async function isAllowed(url: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
        const parsed = new URL(url);

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return { allowed: false, reason: `Scheme ${parsed.protocol} is not allowed.` };
        }

        const host = parsed.hostname.toLowerCase();

        if (BLOCKED_HOSTS.some((block) => host === block || host.startsWith(block) || host.endsWith(block)) ||
            BLOCKED_172.test(host)) {
            return { allowed: false, reason: "Requests to internal/private addresses are blocked." };
        }

        // Reject non-standard IP encodings (octal, hex, bare integer)
        const looksLikeIP = /^[\d.]+$/.test(host) || /^0x/i.test(host);
        if (looksLikeIP && !STANDARD_IP.test(host)) {
            return { allowed: false, reason: "Non-standard IP encoding is not allowed." };
        }

        // Resolve hostname to IPs and check all resolved addresses
        try {
            const results = await dns.lookup(host, { family: 0 });
            const addresses = Array.isArray(results) ? results.map((r: { address: string }) => r.address) : [(results as { address: string }).address];
            for (const addr of addresses) {
                if (isPrivateIP(addr)) {
                    return { allowed: false, reason: "Requests to internal/private addresses are blocked." };
                }
            }
        } catch {
            return { allowed: false, reason: "Failed to resolve hostname." };
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
            const check = await isAllowed(url);
            if (!check.allowed) {
                return { error: check.reason };
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

            try {
                let currentUrl = url;
                let response!: Response;

                for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                    response = await fetch(currentUrl, {
                        headers: headers as Record<string, string> | undefined,
                        signal: controller.signal,
                        redirect: "manual",
                    });

                    if (response.status >= 300 && response.status < 400) {
                        const location = response.headers.get("location");
                        if (!location) break;
                        const next = new URL(location, currentUrl).toString();
                        const redirectCheck = await isAllowed(next);
                        if (!redirectCheck.allowed) {
                            clearTimeout(timer);
                            return { error: `Redirect blocked: ${redirectCheck.reason}` };
                        }
                        currentUrl = next;
                        continue;
                    }
                    break;
                }

                clearTimeout(timer);

                if (!response.ok) {
                    return { error: `HTTP ${response.status}: ${response.statusText}` };
                }

                const body = await response.text();
                const truncated = body.length > MAX_BODY;

                return {
                    url: currentUrl,
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
