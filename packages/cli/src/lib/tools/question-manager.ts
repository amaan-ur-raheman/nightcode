export type QuestionInput = {
    question: string;
    choices?: string[];
    allowCustom?: boolean;
};

export type QuestionRequest = {
    questions: QuestionInput[];
    resolve: (answers: string[]) => void;
};

export class QuestionManager {
    pending = new Map<string, QuestionRequest>();
    private listeners = new Set<() => void>();

    subscribe(onChange: () => void): () => void {
        this.listeners.add(onChange);
        return () => {
            this.listeners.delete(onChange);
        };
    }

    private notify() {
        for (const listener of this.listeners) {
            listener();
        }
    }

    request(
        questions: QuestionInput[],
        timeoutMs = 120_000,
    ): Promise<string[]> {
        return new Promise((resolve) => {
            const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            this.pending.set(id, { questions, resolve });
            this.notify();

            // Auto-reject after timeout to prevent hanging
            setTimeout(() => {
                if (this.pending.has(id)) {
                    const empty = questions.map(() => '');
                    resolve(empty);
                    this.pending.delete(id);
                    this.notify();
                }
            }, timeoutMs);
        });
    }

    resolve(id: string, answers: string[]) {
        const req = this.pending.get(id);
        if (!req) return;
        req.resolve(answers);
        this.pending.delete(id);
        this.notify();
    }

    reject(id: string) {
        const req = this.pending.get(id);
        if (!req) return;
        const empty = req.questions.map(() => '');
        req.resolve(empty);
        this.pending.delete(id);
        this.notify();
    }

    rejectAll() {
        for (const [, req] of this.pending) {
            const empty = req.questions.map(() => '');
            req.resolve(empty);
        }
        this.pending.clear();
        this.notify();
    }

    get current(): [string, QuestionRequest] | null {
        const entry = this.pending.entries().next();
        return entry.done ? null : entry.value;
    }
}

// Singleton instance for the app
export const questionManager = new QuestionManager();
