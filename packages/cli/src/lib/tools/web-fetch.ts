import { toolInputSchemas } from "@nightcode/shared";
import { MAX_OUTPUT, isPrivateHost } from "./utils";

const TIMEOUT_MS = 15_000;

export async function webFetchTool(input: unknown) {
    const { url, headers } = toolInputSchemas.webFetch.parse(input);

    try {
        const host = new URL(url).hostname.toLowerCase();
        if (isPrivateHost(host)) {
            return { error: "Requests to internal/private addresses are blocked." };
        }
    } catch {
        return { error: "Invalid URL." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) return { error: `HTTP ${response.status}: ${response.statusText}` };

        const reader = response.body?.getReader();
        if (!reader) return { url, status: response.status, contentType: response.headers.get("content-type"), body: "" };

        const decoder = new TextDecoder();
        let body = "";
        let truncated = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                body += decoder.decode(value, { stream: true });
                if (body.length >= MAX_OUTPUT) {
                    truncated = true;
                    break;
                }
            }
        } finally {
            reader.cancel();
        }

        clearTimeout(timer);
        return {
            url,
            status: response.status,
            contentType: response.headers.get("content-type"),
            body: truncated ? body.slice(0, MAX_OUTPUT) : body,
            ...(truncated ? { truncated: true } : {}),
        };
    } catch (err) {
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        return { error: message.includes("aborted") ? `Request timed out after ${TIMEOUT_MS}ms` : `Failed to fetch: ${message}` };
    }
}
