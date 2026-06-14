import { toolInputSchemas } from '@nightcode/shared';
import { MAX_OUTPUT, isPrivateHost } from './utils';

export async function webFetchTool(input: unknown) {
    const { url, method, headers, body } =
        toolInputSchemas.webFetch.parse(input);

    try {
        const host = new URL(url).hostname.toLowerCase();
        if (isPrivateHost(host)) {
            return {
                error: 'Requests to internal/private addresses are blocked.',
            };
        }
    } catch {
        return { error: 'Invalid URL.' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
        const response = await fetch(url, {
            method,
            headers,
            body,
            signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await response.text();
        const tooLong = text.length > MAX_OUTPUT;
        return {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: tooLong
                ? text.slice(0, MAX_OUTPUT) + '\n...(truncated)'
                : text,
            ...(tooLong ? { truncated: true } : {}),
        };
    } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        return {
            error: msg.includes('aborted')
                ? 'Request timed out after 15000ms'
                : `Request failed: ${msg}`,
        };
    }
}
