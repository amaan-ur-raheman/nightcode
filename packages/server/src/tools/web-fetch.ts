import { z } from "zod";
import { tool } from "ai";
import { dns } from "bun";
import { checkServerIdentity, type PeerCertificate } from "tls";

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
        // IPv4-mapped IPv6 (::ffff:x.x.x.x)
        const v4Mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (v4Mapped) {
            return isPrivateIP(v4Mapped[1]!);
        }
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

// Returns allowed + the pinned IP to use for the actual request (avoids TOCTOU re-resolution)
async function isAllowed(url: string): Promise<{ allowed: boolean; reason?: string; pinnedIP?: string }> {
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

        // Resolve hostname to IPs, validate all, and pin the first safe one
        try {
            const results = await dns.lookup(host, { family: 0 });
            const addresses = Array.isArray(results)
                ? results.map((r: { address: string }) => r.address)
                : [(results as { address: string }).address];
            for (const addr of addresses) {
                if (isPrivateIP(addr)) {
                    return { allowed: false, reason: "Requests to internal/private addresses are blocked." };
                }
            }
            // Pin the first resolved address — fetch will use this IP directly, no re-resolution
            return { allowed: true, pinnedIP: addresses[0] };
        } catch {
            return { allowed: false, reason: "Failed to resolve hostname." };
        }
    } catch {
        return { allowed: false, reason: "Invalid URL." };
    }
}

// Build a URL with the hostname replaced by the pinned IP, preserving port/path/query
function pinURL(originalUrl: string, ip: string): string {
    const u = new URL(originalUrl);
    const isIPv6 = ip.includes(":");
    u.hostname = isIPv6 ? `[${ip}]` : ip;
    return u.toString();
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
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
                let pinnedIP = check.pinnedIP!;
                let response!: Response;

                for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                    const parsed = new URL(currentUrl);
                    const hostname = parsed.hostname;
                    const fetchUrl = pinURL(currentUrl, pinnedIP);

                    const mergedHeaders: Record<string, string> = {
                        ...(headers as Record<string, string> | undefined),
                        Host: hostname,
                    };

                    response = await fetch(fetchUrl, {
                        headers: mergedHeaders,
                        signal: controller.signal,
                        redirect: "manual",
                        // For HTTPS: validate the cert against the original hostname, not the IP
                        ...(parsed.protocol === "https:" ? {
                            tls: {
                                checkServerIdentity: (_: string, cert: PeerCertificate) => checkServerIdentity(hostname, cert),
                            },
                        } : {}),
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
                        pinnedIP = redirectCheck.pinnedIP!;
                        continue;
                    }
                    break;
                }

                clearTimeout(timer);

                if (response.status >= 300 && response.status < 400) {
                    return { error: `Too many redirects (max ${MAX_REDIRECTS})` };
                }

                if (!response.ok) {
                    return { error: `HTTP ${response.status}: ${response.statusText}` };
                }

                // Stream the body to honor AbortController during reads
                const reader = response.body?.getReader();
                if (!reader) {
                    return { url: currentUrl, status: response.status, contentType: response.headers.get("content-type"), body: "" };
                }

                const chunks: Uint8Array[] = [];
                let totalRead = 0;
                let totalLength: number | undefined;

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        totalRead += value.byteLength;
                        if (totalRead >= MAX_BODY) {
                            // Keep draining to determine full length, but stop accumulating
                            totalLength = totalRead;
                            try {
                                while (true) {
                                    const { done: d, value: v } = await reader.read();
                                    if (d) break;
                                    totalLength += v.byteLength;
                                }
                            } catch { /* timeout or abort during drain */ }
                            break;
                        }
                    }
                } finally {
                    reader.releaseLock();
                }

                clearTimeout(timer);

                const decoder = new TextDecoder();
                const body = decoder.decode(
                    chunks.length === 1 ? chunks[0] : concatUint8Arrays(chunks),
                    { stream: totalRead >= MAX_BODY },
                );
                const truncated = totalLength !== undefined;

                return {
                    url: currentUrl,
                    status: response.status,
                    contentType: response.headers.get("content-type"),
                    body: truncated ? body.slice(0, MAX_BODY) + "\n...(truncated)" : body,
                    ...(truncated ? { truncated: true, totalLength } : {}),
                };
            } catch (err) {
                clearTimeout(timer);
                const message = err instanceof Error ? err.message : String(err);
                return { error: message.includes("aborted") ? `Request timed out after ${DEFAULT_TIMEOUT}ms` : `Failed to fetch URL: ${message}` };
            }
        },
    });
}
