import { toolInputSchemas } from "@nightcode/shared";
import { MAX_OUTPUT } from "./utils";

const PRIVATE = [
    "localhost", "127.", "0.0.0.0", "10.", "192.168.", "169.254.", "::1", ".local",
    "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
];

export async function httpRequestTool(input: unknown) {
    const { url, method, headers, body } = toolInputSchemas.httpRequest.parse(input);

    try {
        const host = new URL(url).hostname.toLowerCase();
        if (PRIVATE.some((p) => host === p || host.startsWith(p) || host.endsWith(p))) {
            return { error: "Requests to internal/private addresses are blocked." };
        }
    } catch {
        return { error: "Invalid URL." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
        const response = await fetch(url, { method, headers: headers as HeadersInit | undefined, body, signal: controller.signal });
        clearTimeout(timer);
        const text = await response.text();
        const tooLong = text.length > MAX_OUTPUT;
        return {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: tooLong ? text.slice(0, MAX_OUTPUT) + "\n...(truncated)" : text,
            ...(tooLong ? { truncated: true } : {}),
        };
    } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        return { error: msg.includes("aborted") ? "Request timed out after 15000ms" : `Request failed: ${msg}` };
    }
}
