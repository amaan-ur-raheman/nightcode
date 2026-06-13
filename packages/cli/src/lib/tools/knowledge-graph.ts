import { toolInputSchemas } from '@nightcode/shared';
import { knowledgeGraphManager } from '../knowledge-graph';

export async function buildKnowledgeGraphTool(input: unknown) {
    const { includePatterns, excludePatterns } =
        toolInputSchemas.buildKnowledgeGraph.parse(input);

    const projectRoot = process.cwd();
    const result = await knowledgeGraphManager.buildFromProject(projectRoot, {
        includePatterns,
        excludePatterns,
    });

    const stats = result.stats;
    const lines: string[] = [
        `Knowledge graph built in ${result.durationMs}ms from ${result.filesScanned} files.`,
        '',
        `Nodes: ${stats.totalNodes} total`,
        `  Files: ${stats.nodesByType.file}`,
        `  Functions: ${stats.nodesByType.function}`,
        `  Classes: ${stats.nodesByType.class}`,
        `  Interfaces: ${stats.nodesByType.interface}`,
        `  Types: ${stats.nodesByType.type}`,
        `  Variables: ${stats.nodesByType.variable}`,
        `  Dependencies: ${stats.nodesByType.dependency}`,
        `  Configs: ${stats.nodesByType.config}`,
        '',
        `Edges: ${stats.totalEdges} total`,
        `  Imports: ${stats.edgesByType.imports}`,
        `  Defines: ${stats.edgesByType.defines}`,
        `  Calls: ${stats.edgesByType.calls}`,
        `  Depends-on: ${stats.edgesByType['depends-on']}`,
        `  Extends: ${stats.edgesByType.extends}`,
        `  Implements: ${stats.edgesByType.implements}`,
        `  Configures: ${stats.edgesByType.configures}`,
    ];

    return { output: lines.join('\n') };
}

export async function queryKnowledgeGraphTool(input: unknown) {
    const { nodeType, name, filePath, exported, limit } =
        toolInputSchemas.queryKnowledgeGraph.parse(input);

    const results = await knowledgeGraphManager.query({
        nodeType,
        name,
        filePath,
        exported,
        limit,
    });

    if (results.length === 0) {
        return { output: 'No nodes match the query.' };
    }

    const lines = results.map((node) => {
        const parts = [`[${node.type}] ${node.name} (id: ${node.id})`];
        if (node.filePath) parts.push(`  File: ${node.filePath}`);
        if (node.description) parts.push(`  ${node.description}`);
        if (node.exported) parts.push('  (exported)');
        if (node.packageName)
            parts.push(`  Package: ${node.packageName}@${node.version ?? '?'}`);
        return parts.join('\n');
    });

    return { output: lines.join('\n\n') };
}

export async function getKnowledgeNeighborsTool(input: unknown) {
    const { nodeId, maxDepth } =
        toolInputSchemas.getKnowledgeNeighbors.parse(input);

    const depth = Math.min(Math.max(1, maxDepth), 5);
    const neighbors = await knowledgeGraphManager.getNeighbors(nodeId);

    if (neighbors.length === 0) {
        const node = await knowledgeGraphManager.getNode(nodeId);
        if (!node) {
            return {
                output: `Node "${nodeId}" not found. Use queryKnowledgeGraph to find valid node IDs.`,
            };
        }
        return {
            output: `Node "${node.name}" (${node.type}) has no connections.`,
        };
    }

    const lines = [`Connections for ${nodeId}:`, ''];

    for (const neighbor of neighbors) {
        const dir = neighbor.direction === 'outgoing' ? '→' : '←';
        lines.push(
            `  ${dir} [${neighbor.edge.type}] ${neighbor.node.name} (${neighbor.node.type})`,
        );
        if (neighbor.node.filePath) {
            lines.push(`      File: ${neighbor.node.filePath}`);
        }
    }

    // If depth > 1, do a traversal
    if (depth > 1) {
        const traversed = await knowledgeGraphManager.traverse(nodeId, depth);
        if (traversed.length > 0) {
            lines.push('');
            lines.push(`Reachable within depth ${depth}:`);
            for (const node of traversed) {
                lines.push(
                    `  [${node.type}] ${node.name} (${node.filePath ?? 'unknown'})`,
                );
            }
        }
    }

    return { output: lines.join('\n') };
}

export async function addKnowledgeNodeTool(input: unknown) {
    const { id, type, name, filePath, description } =
        toolInputSchemas.addKnowledgeNode.parse(input);

    const node = await knowledgeGraphManager.addNode({
        id,
        type,
        name,
        filePath,
        description,
        exported: false,
    });

    return {
        output: `Added node: [${node.type}] ${node.name} (id: ${node.id})`,
    };
}

export async function addKnowledgeEdgeTool(input: unknown) {
    const { source, target, type, filePath } =
        toolInputSchemas.addKnowledgeEdge.parse(input);

    // Verify both nodes exist
    const sourceNode = await knowledgeGraphManager.getNode(source);
    if (!sourceNode) {
        return {
            output: `Source node "${source}" not found. Add it first with addKnowledgeNode.`,
        };
    }
    const targetNode = await knowledgeGraphManager.getNode(target);
    if (!targetNode) {
        return {
            output: `Target node "${target}" not found. Add it first with addKnowledgeNode.`,
        };
    }

    const edge = await knowledgeGraphManager.addEdge({
        source,
        target,
        type,
        filePath,
    });

    return {
        output: `Added edge: ${source} →[${edge.type}]→ ${target}`,
    };
}

export async function detectKnowledgeCyclesTool() {
    const cycles = await knowledgeGraphManager.detectCycles();

    if (cycles.length === 0) {
        return { output: 'No circular dependencies detected.' };
    }

    const lines = [`Found ${cycles.length} circular dependency chain(s):`, ''];
    for (let i = 0; i < cycles.length; i++) {
        const cycle = cycles[i]!;
        lines.push(`  Cycle ${i + 1}: ${cycle.join(' → ')}`);
    }

    return { output: lines.join('\n') };
}

export async function getKnowledgeStatsTool() {
    const stats = await knowledgeGraphManager.getStats();
    const lastBuiltDate = stats.lastBuilt
        ? new Date(stats.lastBuilt).toISOString()
        : 'never';

    const lines = [
        'Knowledge Graph Stats',
        '═══════════════════════════════════',
        `Total nodes: ${stats.totalNodes}`,
        `Total edges: ${stats.totalEdges}`,
        `Files tracked: ${stats.filesCount}`,
        `Last built: ${lastBuiltDate}`,
        `Build duration: ${stats.buildDurationMs}ms`,
        '',
        'Nodes by type:',
    ];

    for (const [type, count] of Object.entries(stats.nodesByType)) {
        if (count > 0) lines.push(`  ${type}: ${count}`);
    }

    lines.push('');
    lines.push('Edges by type:');
    for (const [type, count] of Object.entries(stats.edgesByType)) {
        if (count > 0) lines.push(`  ${type}: ${count}`);
    }

    return { output: lines.join('\n') };
}
