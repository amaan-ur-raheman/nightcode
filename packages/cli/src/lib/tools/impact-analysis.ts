import { toolInputSchemas } from '@nightcode/shared';
import { knowledgeGraphManager } from '../knowledge-graph';

export async function impactAnalysisTool(input: unknown) {
    const { nodeId } = toolInputSchemas.impactAnalysis.parse(input);

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

export async function breakingChangeCheckTool(input: unknown) {
    const { nodeId, keptExports } =
        toolInputSchemas.breakingChangeCheck.parse(input);

    const report = await knowledgeGraphManager.checkBreakingChange(
        nodeId,
        keptExports,
    );

    if (report.willBreak) {
        const lines: string[] = [
            `⚠️  Breaking Change Detected!`,
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
        output: `✅ No breaking changes. All exports are preserved.`,
    };
}

export async function suggestMigrationTool(input: unknown) {
    const { nodeId, newName, newFilePath } =
        toolInputSchemas.suggestMigration.parse(input);

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
                ? '🔴'
                : step.priority === 'recommended'
                  ? '🟡'
                  : '⚪';
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
