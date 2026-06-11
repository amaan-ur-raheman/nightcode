import { debug } from "./debug";

export interface AgentMessage {
    id: string;
    from: string;
    to: string;
    type: "task-assigned" | "task-result" | "status-update" | "data-sharing" | "directive";
    payload: unknown;
    timestamp: number;
}

type MessageHandler = (message: AgentMessage) => void;

class MessageBroker {
    private history: AgentMessage[] = [];
    private subscribers = new Map<string, Set<MessageHandler>>();
    private maxHistory = 1000;

    publish(message: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
        const full: AgentMessage = {
            ...message,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
        };

        this.history.push(full);
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }

        debug.log("broker", `Message: ${full.from} → ${full.to} [${full.type}]`);

        // Deliver to subscriber
        const handlers = this.subscribers.get(full.to);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(full);
                } catch {}
            }
        }

        // Also deliver to wildcard subscribers
        const wildcardHandlers = this.subscribers.get("*");
        if (wildcardHandlers) {
            for (const handler of wildcardHandlers) {
                try {
                    handler(full);
                } catch {}
            }
        }

        return full;
    }

    subscribe(agentId: string, handler: MessageHandler): () => void {
        if (!this.subscribers.has(agentId)) {
            this.subscribers.set(agentId, new Set());
        }
        this.subscribers.get(agentId)!.add(handler);
        return () => {
            this.subscribers.get(agentId)?.delete(handler);
        };
    }

    broadcast(message: Omit<AgentMessage, "id" | "timestamp" | "to">): AgentMessage[] {
        const sent: AgentMessage[] = [];
        for (const agentId of this.subscribers.keys()) {
            if (agentId === "*") continue;
            sent.push(this.publish({ ...message, to: agentId }));
        }
        return sent;
    }

    getHistory(agentId?: string): AgentMessage[] {
        if (!agentId) return [...this.history];
        return this.history.filter(
            (m) => m.from === agentId || m.to === agentId || m.to === "*",
        );
    }

    getConversation(agentId1: string, agentId2: string): AgentMessage[] {
        return this.history.filter(
            (m) =>
                (m.from === agentId1 && m.to === agentId2) ||
                (m.from === agentId2 && m.to === agentId1),
        );
    }

    clear(): void {
        this.history = [];
        this.subscribers.clear();
    }
}

export const messageBroker = new MessageBroker();
