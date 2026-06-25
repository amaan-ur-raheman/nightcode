import { toolInputSchemas } from '@nightcode/shared';
import { knowledgeGraphManager } from '../knowledge-graph';

export async function knowledgeGraphTool(input: unknown) {
    const parsed = toolInputSchemas.knowledge_graph.parse(input);
    const { action } = parsed;

    if (action === 'build') {
        const { includePatterns, excludePatterns } = parsed;
        const projectRoot = process.cwd();
        const result = await knowledgeGraphManager.buildFromProject(
            projectRoot,
            {
                includePatterns,
                excludePatterns,
            },
        );

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

    if (action === 'query') {
        const { nodeType, name, filePath, exported, limit } = parsed;
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
                parts.push(
                    `  Package: ${node.packageName}@${node.version ?? '?'}`,
                );
            return parts.join('\n');
        });

        return { output: lines.join('\n\n') };
    }

    if (action === 'neighbors') {
        const { nodeId, maxDepth } = parsed;
        if (!nodeId) throw new Error('nodeId is required for neighbors action');
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

        if (depth > 1) {
            const traversed = await knowledgeGraphManager.traverse(
                nodeId,
                depth,
            );
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

    if (action === 'add_node') {
        const {
            nodeId: id,
            nodeType: type,
            nodeName: name,
            filePath,
            nodeDescription: description,
        } = parsed;
        if (!id || !type || !name) {
            throw new Error(
                'nodeId, nodeType, and nodeName are required for add_node action',
            );
        }
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

    if (action === 'add_edge') {
        const {
            source,
            target,
            edgeType: type,
            edgeFilePath: filePath,
        } = parsed;
        if (!source || !target || !type) {
            throw new Error(
                'source, target, and edgeType are required for add_edge action',
            );
        }

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

    if (action === 'detect_cycles') {
        const cycles = await knowledgeGraphManager.detectCycles();

        if (cycles.length === 0) {
            return { output: 'No circular dependencies detected.' };
        }

        const lines = [
            `Found ${cycles.length} circular dependency chain(s):`,
            '',
        ];
        for (let i = 0; i < cycles.length; i++) {
            const cycle = cycles[i]!;
            lines.push(`  Cycle ${i + 1}: ${cycle.join(' → ')}`);
        }

        return { output: lines.join('\n') };
    }

    if (action === 'stats') {
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

    if (action === 'impact') {
        const { nodeId } = parsed;
        if (!nodeId) throw new Error('nodeId is required for impact action');
        const report = await knowledgeGraphManager.assessImpact(nodeId);

        if (!report.node) {
            return {
                output: `Node "${nodeId}" not found. Use queryKnowledgeGraph to find valid node IDs.`,
            };
        }

        const lines: string[] = [
            `Impact Analysis for [${report.node.type}] ${report.node.name}`,
            `════════════════════════════════════════════════════════════`,
            '',
            `Risk Level: ${report.riskLevel.toUpperCase()}`,
            `Total Affected: ${report.totalAffected} node(s)`,
            `Affected Files: ${report.affectedFiles.length}`,
            '',
        ];

        if (report.directConsumers.length > 0) {
            lines.push(`Direct Consumers (${report.directConsumers.length}):`);
            for (const consumer of report.directConsumers) {
                lines.push(
                    `  → [${consumer.type}] ${consumer.name} (${consumer.filePath ?? 'unknown'})`,
                );
            }
            lines.push('');
        }

        if (report.transitiveConsumers.length > 0) {
            lines.push(
                `Transitive Consumers (${report.transitiveConsumers.length}):`,
            );
            for (const consumer of report.transitiveConsumers) {
                lines.push(
                    `    → [${consumer.type}] ${consumer.name} (${consumer.filePath ?? 'unknown'})`,
                );
            }
            lines.push('');
        }

        if (report.affectedFiles.length > 0) {
            lines.push('Affected Files:');
            for (const file of report.affectedFiles) {
                lines.push(`  • ${file}`);
            }
        }

        if (report.totalAffected === 0) {
            lines.push('No consumers found. Safe to modify.');
        }

        return { output: lines.join('\n') };
    }

    if (action === 'breaking_check') {
        const { nodeId, keptExports } = parsed;
        if (!nodeId || !keptExports)
            throw new Error(
                'nodeId and keptExports are required for breaking_check action',
            );
        const report = await knowledgeGraphManager.checkBreakingChange(
            nodeId,
            keptExports,
        );

        if (report.willBreak) {
            const lines: string[] = [
                `[WARNING] Breaking Change Detected!`,
                '',
                `Node: ${nodeId}`,
                `Removed Exports: ${report.removedExports.join(', ')}`,
                '',
            ];

            if (report.affectedConsumers.length > 0) {
                lines.push(
                    `Affected Consumers (${report.affectedConsumers.length}):`,
                );
                for (const consumer of report.affectedConsumers) {
                    lines.push(
                        `  → [${consumer.type}] ${consumer.name} (${consumer.filePath ?? 'unknown'})`,
                    );
                }
                lines.push('');
            }

            if (report.affectedFiles.length > 0) {
                lines.push('Affected Files:');
                for (const file of report.affectedFiles) {
                    lines.push(`  • ${file}`);
                }
            }

            return { output: lines.join('\n') };
        }

        return {
            output: `[OK] No breaking changes. All exports are preserved.`,
        };
    }

    if (action === 'suggest_migration') {
        const { nodeId, newName, newFilePath } = parsed;
        if (!nodeId)
            throw new Error('nodeId is required for suggest_migration action');
        const steps = await knowledgeGraphManager.generateMigrationPlan(
            nodeId,
            newName,
            newFilePath,
        );

        if (steps.length === 0) {
            return {
                output: `Node "${nodeId}" not found. Use queryKnowledgeGraph to find valid node IDs.`,
            };
        }

        const lines: string[] = [
            `Migration Plan for ${nodeId}`,
            '════════════════════════════════════════════════════════════',
            '',
        ];

        for (const step of steps) {
            const priority =
                step.priority === 'critical'
                    ? '[CRITICAL]'
                    : step.priority === 'recommended'
                      ? '[RECOMMENDED]'
                      : '[INFO]';
            lines.push(`${priority} Step ${step.step}: [${step.action}]`);
            lines.push(`   ${step.description}`);
            if (step.filePath) {
                lines.push(`   File: ${step.filePath}`);
            }
            lines.push('');
        }

        lines.push(`Total steps: ${steps.length}`);
        lines.push(
            `Critical: ${steps.filter((s) => s.priority === 'critical').length}`,
        );

        return { output: lines.join('\n') };
    }

    throw new Error(`Unknown action: ${action}`);
}
