// ─── Node Types ────────────────────────────────────────────────────────────────

export type KnowledgeNodeType =
    | 'file'
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'variable'
    | 'module'
    | 'dependency'
    | 'config'
    | 'api';

export interface KnowledgeNode {
    id: string;
    type: KnowledgeNodeType;
    name: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    /** Language of the source file (e.g., 'typescript', 'javascript', 'json') */
    language?: string;
    /** Module system: 'esm', 'commonjs', or undefined */
    moduleSystem?: 'esm' | 'commonjs';
    /** For dependencies: the package name */
    packageName?: string;
    /** For dependencies: the installed version */
    version?: string;
    /** Whether this node is exported from its file */
    exported?: boolean;
    /** Short description extracted from JSDoc/TSDoc or code context */
    description?: string;
    /** Flexible metadata bag for type-specific data */
    metadata?: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

// ─── Edge Types ────────────────────────────────────────────────────────────────

export type KnowledgeEdgeType =
    | 'imports'
    | 'exports'
    | 'calls'
    | 'depends-on'
    | 'defines'
    | 'extends'
    | 'implements'
    | 'uses'
    | 'references'
    | 'configures';

export interface KnowledgeEdge {
    id: string;
    source: string;
    target: string;
    type: KnowledgeEdgeType;
    /** The file where this relationship occurs */
    filePath?: string;
    /** Line number where the relationship is found */
    line?: number;
    metadata?: Record<string, unknown>;
    createdAt: number;
}

// ─── Graph ─────────────────────────────────────────────────────────────────────

export interface KnowledgeGraphData {
    nodes: Record<string, KnowledgeNode>;
    edges: Record<string, KnowledgeEdge>;
    /** Reverse index: node ID → set of edge IDs where this node is the target */
    incomingEdges: Record<string, string[]>;
    /** Reverse index: node ID → set of edge IDs where this node is the source */
    outgoingEdges: Record<string, string[]>;
    /** File path this graph was built from */
    projectRoot: string;
    /** When the graph was last built/updated */
    lastBuilt: number;
    /** Total number of files scanned */
    filesScanned: number;
    /** Build duration in ms */
    buildDurationMs: number;
}

// ─── Query Types ───────────────────────────────────────────────────────────────

export interface KnowledgeQuery {
    /** Filter by node type */
    nodeType?: KnowledgeNodeType;
    /** Filter by edge type */
    edgeType?: KnowledgeEdgeType;
    /** Filter by file path (substring match) */
    filePath?: string;
    /** Filter by name (substring, case-insensitive) */
    name?: string;
    /** Filter by exported status */
    exported?: boolean;
    /** Maximum results to return */
    limit?: number;
}

export interface KnowledgeStats {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<KnowledgeNodeType, number>;
    edgesByType: Record<KnowledgeEdgeType, number>;
    filesCount: number;
    lastBuilt: number;
    buildDurationMs: number;
}

export interface KnowledgeNeighbor {
    node: KnowledgeNode;
    edge: KnowledgeEdge;
    direction: 'incoming' | 'outgoing';
}

// ─── Impact Analysis Types ──────────────────────────────────────────────────

export interface ImpactReport {
    nodeId: string;
    node: KnowledgeNode | null;
    directConsumers: KnowledgeNode[];
    transitiveConsumers: KnowledgeNode[];
    totalAffected: number;
    affectedFiles: string[];
    riskLevel: 'none' | 'low' | 'medium' | 'high';
}

export interface BreakingChangeReport {
    nodeId: string;
    willBreak: boolean;
    removedExports: string[];
    affectedConsumers: KnowledgeNode[];
    affectedFiles: string[];
}

export type MigrationPriority = 'critical' | 'recommended' | 'optional';

export interface MigrationStep {
    step: number;
    action: string;
    description: string;
    filePath?: string;
    oldName?: string;
    newName?: string;
    priority: MigrationPriority;
}

// ─── Graph Class ───────────────────────────────────────────────────────────────

export class KnowledgeGraph {
    nodes: Map<string, KnowledgeNode> = new Map();
    edges: Map<string, KnowledgeEdge> = new Map();
    incomingEdges: Map<string, string[]> = new Map();
    outgoingEdges: Map<string, string[]> = new Map();
    projectRoot: string = '';
    lastBuilt: number = 0;
    filesScanned: number = 0;
    buildDurationMs: number = 0;

    constructor(projectRoot: string = '') {
        this.projectRoot = projectRoot;
    }

    // ─── Mutation ─────────────────────────────────────────────────────────────

    addNode(
        node: Omit<KnowledgeNode, 'createdAt' | 'updatedAt'>,
    ): KnowledgeNode {
        const now = Date.now();
        const existing = this.nodes.get(node.id);
        const fullNode: KnowledgeNode = {
            ...node,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        this.nodes.set(node.id, fullNode);
        return fullNode;
    }

    addEdge(edge: Omit<KnowledgeEdge, 'id' | 'createdAt'>): KnowledgeEdge {
        const id = `${edge.source}→${edge.target}:${edge.type}`;
        const existing = this.edges.get(id);
        if (existing) {
            // Update existing edge
            existing.filePath = edge.filePath ?? existing.filePath;
            existing.line = edge.line ?? existing.line;
            existing.metadata = edge.metadata ?? existing.metadata;
            return existing;
        }

        const fullEdge: KnowledgeEdge = {
            ...edge,
            id,
            createdAt: Date.now(),
        };
        this.edges.set(id, fullEdge);

        // Update reverse indexes
        const incoming = this.incomingEdges.get(edge.target) ?? [];
        incoming.push(id);
        this.incomingEdges.set(edge.target, incoming);

        const outgoing = this.outgoingEdges.get(edge.source) ?? [];
        outgoing.push(id);
        this.outgoingEdges.set(edge.source, outgoing);

        return fullEdge;
    }

    removeNode(nodeId: string): boolean {
        const removed = this.nodes.delete(nodeId);
        if (!removed) return false;

        // Remove all edges connected to this node and clean up reverse indexes
        const incoming = this.incomingEdges.get(nodeId) ?? [];
        const outgoing = this.outgoingEdges.get(nodeId) ?? [];

        for (const edgeId of [...incoming, ...outgoing]) {
            const edge = this.edges.get(edgeId);
            if (edge) {
                // Clean up reverse index on the OTHER node before deleting
                if (edge.source !== nodeId) {
                    const srcOut = this.outgoingEdges.get(edge.source);
                    if (srcOut) {
                        const idx = srcOut.indexOf(edgeId);
                        if (idx >= 0) srcOut.splice(idx, 1);
                    }
                }
                if (edge.target !== nodeId) {
                    const tgtIn = this.incomingEdges.get(edge.target);
                    if (tgtIn) {
                        const idx = tgtIn.indexOf(edgeId);
                        if (idx >= 0) tgtIn.splice(idx, 1);
                    }
                }
            }
            this.edges.delete(edgeId);
        }

        this.incomingEdges.delete(nodeId);
        this.outgoingEdges.delete(nodeId);
        return true;
    }

    removeEdge(edgeId: string): boolean {
        const edge = this.edges.get(edgeId);
        if (!edge) return false;

        this.edges.delete(edgeId);

        const incoming = this.incomingEdges.get(edge.target);
        if (incoming) {
            const idx = incoming.indexOf(edgeId);
            if (idx >= 0) incoming.splice(idx, 1);
        }

        const outgoing = this.outgoingEdges.get(edge.source);
        if (outgoing) {
            const idx = outgoing.indexOf(edgeId);
            if (idx >= 0) outgoing.splice(idx, 1);
        }

        return true;
    }

    clear(): void {
        this.nodes.clear();
        this.edges.clear();
        this.incomingEdges.clear();
        this.outgoingEdges.clear();
    }

    // ─── Query ────────────────────────────────────────────────────────────────

    getNode(nodeId: string): KnowledgeNode | undefined {
        return this.nodes.get(nodeId);
    }

    getEdge(edgeId: string): KnowledgeEdge | undefined {
        return this.edges.get(edgeId);
    }

    getNeighbors(nodeId: string): KnowledgeNeighbor[] {
        const neighbors: KnowledgeNeighbor[] = [];

        // Outgoing edges
        const outgoing = this.outgoingEdges.get(nodeId) ?? [];
        for (const edgeId of outgoing) {
            const edge = this.edges.get(edgeId);
            if (edge) {
                const targetNode = this.nodes.get(edge.target);
                if (targetNode) {
                    neighbors.push({
                        node: targetNode,
                        edge,
                        direction: 'outgoing',
                    });
                }
            }
        }

        // Incoming edges
        const incoming = this.incomingEdges.get(nodeId) ?? [];
        for (const edgeId of incoming) {
            const edge = this.edges.get(edgeId);
            if (edge) {
                const sourceNode = this.nodes.get(edge.source);
                if (sourceNode) {
                    neighbors.push({
                        node: sourceNode,
                        edge,
                        direction: 'incoming',
                    });
                }
            }
        }

        return neighbors;
    }

    query(filter: KnowledgeQuery): KnowledgeNode[] {
        let results = Array.from(this.nodes.values());

        if (filter.nodeType) {
            results = results.filter((n) => n.type === filter.nodeType);
        }
        if (filter.filePath) {
            const fp = filter.filePath.toLowerCase();
            results = results.filter(
                (n) => n.filePath?.toLowerCase().includes(fp) ?? false,
            );
        }
        if (filter.name) {
            const name = filter.name.toLowerCase();
            results = results.filter((n) =>
                n.name.toLowerCase().includes(name),
            );
        }
        if (filter.exported !== undefined) {
            results = results.filter((n) => n.exported === filter.exported);
        }
        if (filter.limit) {
            results = results.slice(0, filter.limit);
        }

        return results;
    }

    /**
     * Find all nodes reachable from a starting node via outgoing edges
     * (breadth-first traversal up to maxDepth).
     */
    traverse(startNodeId: string, maxDepth: number = 3): KnowledgeNode[] {
        const visited = new Set<string>();
        const result: KnowledgeNode[] = [];
        const queue: Array<{ id: string; depth: number }> = [
            { id: startNodeId, depth: 0 },
        ];

        while (queue.length > 0) {
            const { id, depth } = queue.shift()!;
            if (visited.has(id) || depth > maxDepth) continue;
            visited.add(id);

            const node = this.nodes.get(id);
            if (node && depth > 0) {
                result.push(node);
            }

            if (depth < maxDepth) {
                const outgoing = this.outgoingEdges.get(id) ?? [];
                for (const edgeId of outgoing) {
                    const edge = this.edges.get(edgeId);
                    if (edge) {
                        queue.push({ id: edge.target, depth: depth + 1 });
                    }
                }
            }
        }

        return result;
    }

    /**
     * Detect circular dependencies by finding cycles in the graph.
     * Returns arrays of node IDs forming cycles.
     */
    detectCycles(): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const path: string[] = [];

        const dfs = (nodeId: string): void => {
            if (visiting.has(nodeId)) {
                // Found a cycle — extract the cycle from the path
                const cycleStart = path.indexOf(nodeId);
                if (cycleStart >= 0) {
                    cycles.push(path.slice(cycleStart).concat(nodeId));
                }
                return;
            }
            if (visited.has(nodeId)) return;

            visiting.add(nodeId);
            path.push(nodeId);

            const outgoing = this.outgoingEdges.get(nodeId) ?? [];
            for (const edgeId of outgoing) {
                const edge = this.edges.get(edgeId);
                if (edge) {
                    dfs(edge.target);
                }
            }

            path.pop();
            visiting.delete(nodeId);
            visited.add(nodeId);
        };

        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                dfs(nodeId);
            }
        }

        return cycles;
    }

    // ─── Impact Analysis ──────────────────────────────────────────────────────

    /**
     * Assess the blast radius of changing a node.
     * Returns a structured impact report with categorized consumers.
     */
    assessImpact(nodeId: string): ImpactReport {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return {
                nodeId,
                node: null,
                directConsumers: [],
                transitiveConsumers: [],
                totalAffected: 0,
                affectedFiles: [],
                riskLevel: 'none',
            };
        }

        const direct: KnowledgeNode[] = [];
        const transitive: KnowledgeNode[] = [];
        const visited = new Set<string>([nodeId]);

        // Level 1: direct consumers (incoming edges)
        const incoming = this.incomingEdges.get(nodeId) ?? [];
        for (const edgeId of incoming) {
            const edge = this.edges.get(edgeId);
            if (edge && !visited.has(edge.source)) {
                visited.add(edge.source);
                const consumer = this.nodes.get(edge.source);
                if (consumer) direct.push(consumer);
            }
        }

        // Level 2+: transitive consumers (BFS from direct consumers' incoming edges)
        const queue: Array<{ id: string; depth: number }> = [];
        for (const d of direct) {
            const dIncoming = this.incomingEdges.get(d.id) ?? [];
            for (const edgeId of dIncoming) {
                const edge = this.edges.get(edgeId);
                if (edge && !visited.has(edge.source)) {
                    visited.add(edge.source);
                    queue.push({ id: edge.source, depth: 2 });
                }
            }
        }
        while (queue.length > 0) {
            const { id, depth } = queue.shift()!;

            const n = this.nodes.get(id);
            if (n) transitive.push(n);

            if (depth < 10) {
                const incomingEdges = this.incomingEdges.get(id) ?? [];
                for (const edgeId of incomingEdges) {
                    const edge = this.edges.get(edgeId);
                    if (edge && !visited.has(edge.source)) {
                        visited.add(edge.source);
                        queue.push({ id: edge.source, depth: depth + 1 });
                    }
                }
            }
        }

        const allAffected = [...direct, ...transitive];
        const affectedFiles = [
            ...new Set(allAffected.map((n) => n.filePath).filter(Boolean)),
        ] as string[];

        const riskLevel =
            direct.length === 0 && transitive.length === 0
                ? 'none'
                : direct.length <= 3 && affectedFiles.length <= 3
                  ? 'low'
                  : direct.length <= 10 && affectedFiles.length <= 10
                    ? 'medium'
                    : 'high';

        return {
            nodeId,
            node,
            directConsumers: direct,
            transitiveConsumers: transitive,
            totalAffected: direct.length + transitive.length,
            affectedFiles,
            riskLevel,
        };
    }

    /**
     * Check if changing a node's export signature would break consumers.
     * Compares current neighbors against a hypothetical set of kept exports.
     */
    checkBreakingChange(
        nodeId: string,
        keptExports: string[],
    ): BreakingChangeReport {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return {
                nodeId,
                willBreak: false,
                removedExports: [],
                affectedConsumers: [],
                affectedFiles: [],
            };
        }

        // Find all current exports from this node's file
        const currentExports: string[] = [];
        const outgoing = this.outgoingEdges.get(nodeId) ?? [];
        for (const edgeId of outgoing) {
            const edge = this.edges.get(edgeId);
            if (edge && edge.type === 'exports') {
                const targetNode = this.nodes.get(edge.target);
                if (targetNode) currentExports.push(targetNode.name);
            }
        }

        const removedExports = currentExports.filter(
            (e) => !keptExports.includes(e),
        );

        if (removedExports.length === 0) {
            return {
                nodeId,
                willBreak: false,
                removedExports: [],
                affectedConsumers: [],
                affectedFiles: [],
            };
        }

        // Find consumers that import removed exports
        const affected: KnowledgeNode[] = [];
        const incoming = this.incomingEdges.get(nodeId) ?? [];
        for (const edgeId of incoming) {
            const edge = this.edges.get(edgeId);
            if (edge) {
                const consumer = this.nodes.get(edge.source);
                if (consumer) affected.push(consumer);
            }
        }

        const affectedFiles = [
            ...new Set(affected.map((n) => n.filePath).filter(Boolean)),
        ] as string[];

        return {
            nodeId,
            willBreak: removedExports.length > 0,
            removedExports,
            affectedConsumers: affected,
            affectedFiles,
        };
    }

    /**
     * Generate a migration plan for renaming or moving a node.
     * Returns ordered steps with file paths and descriptions.
     */
    generateMigrationPlan(
        nodeId: string,
        newName?: string,
        newFilePath?: string,
    ): MigrationStep[] {
        const steps: MigrationStep[] = [];
        const node = this.nodes.get(nodeId);
        if (!node) return steps;

        // Find all consumers
        const incoming = this.incomingEdges.get(nodeId) ?? [];
        const consumersByFile = new Map<string, string[]>();

        for (const edgeId of incoming) {
            const edge = this.edges.get(edgeId);
            if (edge) {
                const consumer = this.nodes.get(edge.source);
                if (consumer?.filePath) {
                    const fileSteps =
                        consumersByFile.get(consumer.filePath) ?? [];
                    fileSteps.push(consumer.name);
                    consumersByFile.set(consumer.filePath, fileSteps);
                }
            }
        }

        // Step 1: Update the definition
        if (newName || newFilePath) {
            steps.push({
                step: steps.length + 1,
                action: 'update-definition',
                description: newName
                    ? `Rename '${node.name}' to '${newName}' in ${node.filePath ?? 'unknown'}`
                    : `Move '${node.name}' from ${node.filePath} to ${newFilePath}`,
                filePath: node.filePath,
                oldName: node.name,
                newName: newName ?? node.name,
                priority: 'critical',
            });
        }

        // Step 2: Update each consumer
        for (const [filePath, symbols] of consumersByFile) {
            steps.push({
                step: steps.length + 1,
                action: 'update-import',
                description: `Update import${symbols.length > 1 ? 's' : ''} of [${symbols.join(', ')}] in ${filePath}`,
                filePath,
                oldName: node.name,
                newName: newName ?? node.name,
                priority: 'critical',
            });
        }

        // Step 3: Run tests
        steps.push({
            step: steps.length + 1,
            action: 'run-tests',
            description: 'Run test suite to verify no regressions',
            priority: 'recommended',
        });

        return steps;
    }

    // ─── Stats ────────────────────────────────────────────────────────────────

    getStats(): KnowledgeStats {
        const nodesByType: Record<KnowledgeNodeType, number> = {
            file: 0,
            function: 0,
            class: 0,
            interface: 0,
            type: 0,
            variable: 0,
            module: 0,
            dependency: 0,
            config: 0,
            api: 0,
        };
        const edgesByType: Record<KnowledgeEdgeType, number> = {
            imports: 0,
            exports: 0,
            calls: 0,
            'depends-on': 0,
            defines: 0,
            extends: 0,
            implements: 0,
            uses: 0,
            references: 0,
            configures: 0,
        };

        for (const node of this.nodes.values()) {
            nodesByType[node.type]++;
        }
        for (const edge of this.edges.values()) {
            edgesByType[edge.type]++;
        }

        const filePaths = new Set<string>();
        for (const node of this.nodes.values()) {
            if (node.filePath) filePaths.add(node.filePath);
        }

        return {
            totalNodes: this.nodes.size,
            totalEdges: this.edges.size,
            nodesByType,
            edgesByType,
            filesCount: filePaths.size,
            lastBuilt: this.lastBuilt,
            buildDurationMs: this.buildDurationMs,
        };
    }

    // ─── Serialization ────────────────────────────────────────────────────────

    toJSON(): KnowledgeGraphData {
        return {
            nodes: Object.fromEntries(this.nodes),
            edges: Object.fromEntries(this.edges),
            incomingEdges: Object.fromEntries(this.incomingEdges),
            outgoingEdges: Object.fromEntries(this.outgoingEdges),
            projectRoot: this.projectRoot,
            lastBuilt: this.lastBuilt,
            filesScanned: this.filesScanned,
            buildDurationMs: this.buildDurationMs,
        };
    }

    static fromJSON(data: KnowledgeGraphData): KnowledgeGraph {
        const graph = new KnowledgeGraph(data.projectRoot);
        graph.lastBuilt = data.lastBuilt;
        graph.filesScanned = data.filesScanned;
        graph.buildDurationMs = data.buildDurationMs;

        for (const [id, node] of Object.entries(data.nodes)) {
            graph.nodes.set(id, node);
        }
        for (const [id, edge] of Object.entries(data.edges)) {
            graph.edges.set(id, edge);
        }
        for (const [id, edgeIds] of Object.entries(data.incomingEdges)) {
            graph.incomingEdges.set(id, edgeIds);
        }
        for (const [id, edgeIds] of Object.entries(data.outgoingEdges)) {
            graph.outgoingEdges.set(id, edgeIds);
        }

        return graph;
    }
}
