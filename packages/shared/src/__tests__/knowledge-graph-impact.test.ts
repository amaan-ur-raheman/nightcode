import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '@nightcode/shared';

describe('KnowledgeGraph impact analysis', () => {
    let graph: KnowledgeGraph;

    beforeEach(() => {
        graph = new KnowledgeGraph('/test/project');
    });

    describe('assessImpact', () => {
        it('returns no impact for unknown node', () => {
            const report = graph.assessImpact('nonexistent');
            expect(report.totalAffected).toBe(0);
            expect(report.riskLevel).toBe('none');
            expect(report.directConsumers).toHaveLength(0);
            expect(report.transitiveConsumers).toHaveLength(0);
        });

        it('returns no impact for isolated node', () => {
            graph.addNode({
                id: 'function:src/utils.ts#helper',
                type: 'function',
                name: 'helper',
                filePath: 'src/utils.ts',
                exported: true,
            });
            const report = graph.assessImpact('function:src/utils.ts#helper');
            expect(report.totalAffected).toBe(0);
            expect(report.riskLevel).toBe('none');
            expect(report.node).not.toBeNull();
            expect(report.node!.name).toBe('helper');
        });

        it('detects direct consumers via incoming edges', () => {
            graph.addNode({
                id: 'file:src/utils.ts',
                type: 'file',
                name: 'utils.ts',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'function:src/utils.ts#formatDate',
                type: 'function',
                name: 'formatDate',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'file:src/api.ts',
                type: 'file',
                name: 'api.ts',
                filePath: 'src/api.ts',
                exported: true,
            });
            graph.addNode({
                id: 'file:src/routes.ts',
                type: 'file',
                name: 'routes.ts',
                filePath: 'src/routes.ts',
                exported: true,
            });

            // api.ts imports utils.ts, routes.ts imports api.ts
            graph.addEdge({
                source: 'file:src/api.ts',
                target: 'file:src/utils.ts',
                type: 'imports',
            });
            graph.addEdge({
                source: 'file:src/routes.ts',
                target: 'file:src/api.ts',
                type: 'imports',
            });

            const report = graph.assessImpact('file:src/utils.ts');
            expect(report.directConsumers).toHaveLength(1);
            expect(report.directConsumers[0]!.id).toBe('file:src/api.ts');
            expect(report.transitiveConsumers).toHaveLength(1);
            expect(report.transitiveConsumers[0]!.id).toBe(
                'file:src/routes.ts',
            );
            expect(report.totalAffected).toBe(2);
            expect(report.riskLevel).not.toBe('none');
        });

        it('computes correct affected files list', () => {
            graph.addNode({
                id: 'function:src/auth.ts#validate',
                type: 'function',
                name: 'validate',
                filePath: 'src/auth.ts',
                exported: true,
            });
            graph.addNode({
                id: 'file:src/api.ts',
                type: 'file',
                name: 'api.ts',
                filePath: 'src/api.ts',
                exported: true,
            });
            graph.addNode({
                id: 'file:src/middleware.ts',
                type: 'file',
                name: 'middleware.ts',
                filePath: 'src/middleware.ts',
                exported: true,
            });
            graph.addEdge({
                source: 'file:src/api.ts',
                target: 'function:src/auth.ts#validate',
                type: 'imports',
            });
            graph.addEdge({
                source: 'file:src/middleware.ts',
                target: 'function:src/auth.ts#validate',
                type: 'imports',
            });

            const report = graph.assessImpact('function:src/auth.ts#validate');
            expect(report.affectedFiles).toContain('src/api.ts');
            expect(report.affectedFiles).toContain('src/middleware.ts');
            expect(report.affectedFiles).toHaveLength(2);
        });

        it('assigns high risk for many direct consumers', () => {
            graph.addNode({
                id: 'function:src/core.ts#process',
                type: 'function',
                name: 'process',
                filePath: 'src/core.ts',
                exported: true,
            });
            for (let i = 0; i < 15; i++) {
                graph.addNode({
                    id: `file:src/consumer${i}.ts`,
                    type: 'file',
                    name: `consumer${i}.ts`,
                    filePath: `src/consumer${i}.ts`,
                    exported: true,
                });
                graph.addEdge({
                    source: `file:src/consumer${i}.ts`,
                    target: 'function:src/core.ts#process',
                    type: 'imports',
                });
            }

            const report = graph.assessImpact('function:src/core.ts#process');
            expect(report.riskLevel).toBe('high');
            expect(report.totalAffected).toBe(15);
        });
    });

    describe('checkBreakingChange', () => {
        it('returns no breakage for unknown node', () => {
            const report = graph.checkBreakingChange('nonexistent', []);
            expect(report.willBreak).toBe(false);
            expect(report.removedExports).toHaveLength(0);
        });

        it('returns no breakage when all exports are kept', () => {
            graph.addNode({
                id: 'file:src/utils.ts',
                type: 'file',
                name: 'utils.ts',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'export:src/utils.ts#formatDate',
                type: 'function',
                name: 'formatDate',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addEdge({
                source: 'file:src/utils.ts',
                target: 'export:src/utils.ts#formatDate',
                type: 'exports',
            });

            const report = graph.checkBreakingChange('file:src/utils.ts', [
                'formatDate',
            ]);
            expect(report.willBreak).toBe(false);
            expect(report.removedExports).toHaveLength(0);
        });

        it('detects breaking changes when exports are removed', () => {
            graph.addNode({
                id: 'file:src/utils.ts',
                type: 'file',
                name: 'utils.ts',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'export:src/utils.ts#formatDate',
                type: 'function',
                name: 'formatDate',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'export:src/utils.ts#parseDate',
                type: 'function',
                name: 'parseDate',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addEdge({
                source: 'file:src/utils.ts',
                target: 'export:src/utils.ts#formatDate',
                type: 'exports',
            });
            graph.addEdge({
                source: 'file:src/utils.ts',
                target: 'export:src/utils.ts#parseDate',
                type: 'exports',
            });

            // Only keep formatDate, removing parseDate
            const report = graph.checkBreakingChange('file:src/utils.ts', [
                'formatDate',
            ]);
            expect(report.willBreak).toBe(true);
            expect(report.removedExports).toContain('parseDate');
        });

        it('lists affected consumers on breaking change', () => {
            graph.addNode({
                id: 'file:src/utils.ts',
                type: 'file',
                name: 'utils.ts',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'export:src/utils.ts#formatDate',
                type: 'function',
                name: 'formatDate',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addEdge({
                source: 'file:src/utils.ts',
                target: 'export:src/utils.ts#formatDate',
                type: 'exports',
            });
            graph.addNode({
                id: 'file:src/api.ts',
                type: 'file',
                name: 'api.ts',
                filePath: 'src/api.ts',
                exported: true,
            });
            graph.addEdge({
                source: 'file:src/api.ts',
                target: 'file:src/utils.ts',
                type: 'imports',
            });

            const report = graph.checkBreakingChange('file:src/utils.ts', []);
            expect(report.willBreak).toBe(true);
            expect(report.removedExports).toContain('formatDate');
            expect(report.affectedConsumers).toHaveLength(1);
            expect(report.affectedConsumers[0]!.id).toBe('file:src/api.ts');
        });
    });

    describe('generateMigrationPlan', () => {
        it('returns empty for unknown node', () => {
            const steps = graph.generateMigrationPlan('nonexistent', 'newName');
            expect(steps).toHaveLength(0);
        });

        it('generates rename steps', () => {
            graph.addNode({
                id: 'function:src/utils.ts#helper',
                type: 'function',
                name: 'helper',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'file:src/api.ts',
                type: 'file',
                name: 'api.ts',
                filePath: 'src/api.ts',
                exported: true,
            });
            graph.addEdge({
                source: 'file:src/api.ts',
                target: 'function:src/utils.ts#helper',
                type: 'imports',
            });

            const steps = graph.generateMigrationPlan(
                'function:src/utils.ts#helper',
                'myHelper',
            );
            expect(steps.length).toBeGreaterThanOrEqual(2);
            expect(steps[0]!.action).toBe('update-definition');
            expect(steps[0]!.newName).toBe('myHelper');
            expect(steps[0]!.priority).toBe('critical');
            expect(steps.some((s) => s.action === 'update-import')).toBe(true);
        });

        it('includes run-tests step at the end', () => {
            graph.addNode({
                id: 'function:src/utils.ts#helper',
                type: 'function',
                name: 'helper',
                filePath: 'src/utils.ts',
                exported: true,
            });

            const steps = graph.generateMigrationPlan(
                'function:src/utils.ts#helper',
                'myHelper',
            );
            const lastStep = steps[steps.length - 1]!;
            expect(lastStep.action).toBe('run-tests');
            expect(lastStep.priority).toBe('recommended');
        });

        it('includes all consumer files', () => {
            graph.addNode({
                id: 'function:src/utils.ts#helper',
                type: 'function',
                name: 'helper',
                filePath: 'src/utils.ts',
                exported: true,
            });
            graph.addNode({
                id: 'file:src/api.ts',
                type: 'file',
                name: 'api.ts',
                filePath: 'src/api.ts',
                exported: true,
            });
            graph.addNode({
                id: 'file:src/routes.ts',
                type: 'file',
                name: 'routes.ts',
                filePath: 'src/routes.ts',
                exported: true,
            });
            graph.addEdge({
                source: 'file:src/api.ts',
                target: 'function:src/utils.ts#helper',
                type: 'imports',
            });
            graph.addEdge({
                source: 'file:src/routes.ts',
                target: 'function:src/utils.ts#helper',
                type: 'imports',
            });

            const steps = graph.generateMigrationPlan(
                'function:src/utils.ts#helper',
                'myHelper',
            );
            const importSteps = steps.filter(
                (s) => s.action === 'update-import',
            );
            expect(importSteps).toHaveLength(2);
            expect(
                importSteps
                    .map((s) => s.filePath)
                    .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
            ).toEqual(['src/api.ts', 'src/routes.ts']);
        });
    });
});
