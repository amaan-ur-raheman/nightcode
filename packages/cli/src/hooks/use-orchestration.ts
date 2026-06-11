import { useState, useCallback, useEffect } from "react";
import type { TaskGraph } from "@nightcode/shared";
import { orchestratorManager, type OrchestratorState } from "@/lib/orchestrator-manager";

export function useOrchestration() {
    const [activeOrchestrations, setActiveOrchestrations] = useState<OrchestratorState[]>(
        () => orchestratorManager.getAll(),
    );

    useEffect(() => {
        const unsubscribe = orchestratorManager.subscribe((states) => {
            setActiveOrchestrations(states);
        });
        return unsubscribe;
    }, []);

    const activeCount = activeOrchestrations.length;
    const activeGraphs = activeOrchestrations.map((s) => s.graph);

    const getGraphStats = useCallback((graph: TaskGraph) => {
        const nodes = Object.values(graph.nodes);
        const completed = nodes.filter((n) => n.status === "completed").length;
        const failed = nodes.filter((n) => n.status === "failed").length;
        const running = nodes.filter((n) => n.status === "running").length;
        const total = nodes.length;
        return { completed, failed, running, total, progress: total > 0 ? completed / total : 0 };
    }, []);

    return {
        activeOrchestrations,
        activeCount,
        activeGraphs,
        getGraphStats,
    };
}
