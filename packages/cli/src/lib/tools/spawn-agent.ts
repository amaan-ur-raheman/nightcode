import { readUIMessageStream, uiMessageChunkSchema, parseJsonEventStream } from "ai";
import { toolInputSchemas, type ModeType } from "@nightcode/shared";
import { getAuth } from "@/lib/auth";
import { executeLocalTool } from "@/lib/local-tools";

import { registerSubagent, updateSubagentStep, removeSubagent } from "@/lib/subagent-progress";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const MAX_STEPS = 50;
const SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT_SUBAGENTS = 5;
let activeSubagents = 0;

export async function spawnAgentTool(
    input: unknown,
    parentMode?: ModeType,
    parentModel?: string,
    signal?: AbortSignal,
) {
    const { task, model, mode } = toolInputSchemas.spawnAgent.parse(input);
    const resolvedModel = model ?? parentModel ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

    if (parentMode === "PLAN" && mode === "BUILD") {
        throw new Error("Cannot spawn a BUILD mode subagent from a PLAN mode parent. Please spawn a PLAN mode subagent instead.");
    }

    if (activeSubagents >= MAX_CONCURRENT_SUBAGENTS) {
        throw new Error(`Too many concurrent subagents (${MAX_CONCURRENT_SUBAGENTS}). Wait for existing ones to complete.`);
    }
    activeSubagents++;

    const auth = getAuth();
    if (!auth) throw new Error("Not authenticated. Run /login to continue.");

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), SUBAGENT_TIMEOUT_MS);

    const combinedController = new AbortController();
    const onTimeout = () => combinedController.abort(timeoutController.signal.reason);
    const onCaller  = () => combinedController.abort(signal!.reason);
    timeoutController.signal.addEventListener("abort", onTimeout, { once: true });
    signal?.addEventListener("abort", onCaller, { once: true });

    const subagentId = crypto.randomUUID();
    registerSubagent(subagentId, task, MAX_STEPS);

    try {
        return await _runSubagent({ task, mode, resolvedModel, auth, signal: combinedController.signal, subagentId });
    } catch (err: any) {
        if (timeoutController.signal.aborted && !signal?.aborted) {
            throw new Error(`Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60000} minutes`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
        timeoutController.signal.removeEventListener("abort", onTimeout);
        signal?.removeEventListener("abort", onCaller);
        activeSubagents--;
        removeSubagent(subagentId);
    }
}

async function _runSubagent({ task, mode, resolvedModel, auth, signal, subagentId }: {
    task: string;
    mode: string;
    resolvedModel: string;
    auth: { token: string };
    signal: AbortSignal;
    subagentId: string;
}) {
    const messages: any[] = [
        {
            id: crypto.randomUUID(),
            role: "user" as const,
            parts: [{ type: "text" as const, text: task }],
        }
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 5; attempt++) {
            response = await fetch(`${API_URL}/subagent`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ messages, model: resolvedModel, mode }),
                signal,
            });
            if (response.status !== 429) break;
            await new Promise<void>((resolve, reject) => {
                if (signal.aborted) { reject(new Error("Aborted")); return; }
                const t = setTimeout(resolve, (attempt + 1) * 3000);
                signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Aborted")); }, { once: true });
            });
        }

        if (!response || !response.ok) {
            const body = await response?.json().catch(() => ({})) as { error?: string };
            if (!response || response.status === 429) {
                throw new Error("Rate limit hit. Wait a moment and try again.");
            }
            throw new Error(body.error ?? `Subagent failed with status ${response.status}`);
        }

        if (!response.body) throw new Error("No response body from subagent");

        const chunkStream = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema })
            .pipeThrough(new TransformStream({
                async transform(chunk, controller) {
                    if (!chunk.success) throw chunk.error;
                    controller.enqueue(chunk.value);
                }
            }));

        const stream = readUIMessageStream({ stream: chunkStream });
        let assistantMessage: any = null;

        try {
            for await (const message of stream) {
                assistantMessage = message;
            }
        } catch (streamErr: any) {
            const msg = streamErr?.message ?? String(streamErr);
            if (msg.includes("429") || msg.toLowerCase().includes("too many requests")) {
                throw new Error("Rate limit hit. Wait a moment and try again.");
            }
            throw streamErr;
        }

        if (!assistantMessage) {
            throw new Error("No message received from subagent");
        }

        const existingIndex = messages.findIndex(m => m.id === assistantMessage.id);
        if (existingIndex === -1) {
            messages.push(assistantMessage);
        } else {
            messages[existingIndex] = assistantMessage;
        }

        const toolCallsToExecute = assistantMessage.parts.filter((part: any) => {
            if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                return part.state === "input-available";
            }
            return false;
        });

        if (toolCallsToExecute.length === 0) {
            const textContent = assistantMessage.parts
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("").trim();

            if (textContent) return { result: textContent };

            // Fall back to reasoning content if text is empty
            const reasoningContent = assistantMessage.parts
                .filter((p: any) => p.type === "reasoning")
                .map((p: any) => p.text)
                .join("").trim();

            if (reasoningContent) return { result: reasoningContent };

            throw new Error("Subagent completed but returned no output. The main agent should handle this task directly.");
        }

        const toolNames = toolCallsToExecute.map((part: any) =>
            part.type === "dynamic-tool" ? part.toolName : part.type.slice(5)
        );
        console.error(`[subagent] step ${step + 1}: executing ${toolNames.join(", ")}`);
        updateSubagentStep(subagentId, step + 1, toolNames[0] ?? null);

        await Promise.all(
            toolCallsToExecute.map(async (part: any) => {
                const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
                if (toolName.startsWith("spawn")) {
                    part.state = "output-error";
                    part.errorText = "Spawn tools are not allowed from within a subagent";
                    return;
                }
                try {
                    const output = await executeLocalTool(toolName, part.input, mode as ModeType, resolvedModel, signal);
                    part.state = "output-available";
                    part.output = output;
                } catch (error: any) {
                    part.state = "output-error";
                    part.errorText = error?.message || String(error);
                }
            })
        );
    }

    throw new Error(`Subagent exceeded maximum steps (${MAX_STEPS})`);
}
