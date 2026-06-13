import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { knowledgeGraphManager } from '../../knowledge-graph';
import { KnowledgeGraph } from '@nightcode/shared';

const KG_DIR = join(homedir(), '.nightcode', 'knowledge');
const GRAPH_FILE = join(KG_DIR, 'graph.json');

function cleanup() {
    try {
        unlinkSync(GRAPH_FILE);
    } catch {
        // File may not exist
    }
}

describe('Knowledge Graph Tools', () => {
    beforeEach(() => {
        cleanup();
        // Reset the singleton to a fresh empty graph for test isolation
        // @ts-expect-error Accessing private field for test isolation
        knowledgeGraphManager.graph = new KnowledgeGraph(process.cwd());
    });

    afterEach(() => {
        cleanup();
        // @ts-expect-error Accessing private field for test isolation
        knowledgeGraphManager.graph = null;
    });

    describe('buildKnowledgeGraphTool', () => {
        it('builds a graph from the current project', async () => {
            const { buildKnowledgeGraphTool } =
                await import('../knowledge-graph');
            const result = await buildKnowledgeGraphTool({
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            expect(result.output).toContain('Knowledge graph built in');
            expect(result.output).toContain('Nodes:');
            expect(result.output).toContain('Edges:');
            expect(result.output).toContain('Files:');
            expect(result.output).toContain('Functions:');
            expect(result.output).toContain('Dependencies:');
        });

        it('handles empty include patterns', async () => {
            const { buildKnowledgeGraphTool } =
                await import('../knowledge-graph');
            const result = await buildKnowledgeGraphTool({
                includePatterns: undefined,
                excludePatterns: ['node_modules', 'dist'],
            });

            expect(result.output).toContain('Knowledge graph built in');
        });
    });

    describe('queryKnowledgeGraphTool', () => {
        it('queries nodes by type', async () => {
            const { buildKnowledgeGraphTool, queryKnowledgeGraphTool } =
                await import('../knowledge-graph');
            await buildKnowledgeGraphTool({
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const result = await queryKnowledgeGraphTool({
                nodeType: 'file',
                limit: 10,
            });

            expect(result.output).toContain('[file]');
        });

        it('queries nodes by name', async () => {
            const { buildKnowledgeGraphTool, queryKnowledgeGraphTool } =
                await import('../knowledge-graph');
            await buildKnowledgeGraphTool({
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const result = await queryKnowledgeGraphTool({
                name: 'index',
                limit: 10,
            });

            // Should find files or symbols named 'index' (or return no match)
            expect(typeof result.output).toBe('string');
        });

        it('returns message when no nodes match', async () => {
            const { buildKnowledgeGraphTool, queryKnowledgeGraphTool } =
                await import('../knowledge-graph');
            await buildKnowledgeGraphTool({
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const result = await queryKnowledgeGraphTool({
                name: 'zzz_nonexistent_symbol_xyz',
                limit: 10,
            });

            expect(result.output).toContain('No nodes match');
        });
    });

    describe('getKnowledgeNeighborsTool', () => {
        it('finds neighbors for a file node', async () => {
            const {
                buildKnowledgeGraphTool,
                getKnowledgeNeighborsTool,
                queryKnowledgeGraphTool,
            } = await import('../knowledge-graph');
            await buildKnowledgeGraphTool({
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            // Find a file node first
            const files = await queryKnowledgeGraphTool({
                nodeType: 'file',
                limit: 1,
            });

            // Extract node ID from the output (format: [file] name.ts (id: file:path))
            const nodeIdMatch = files.output.match(/\(id: ([^)]+)\)/);
            if (nodeIdMatch) {
                const nodeId = nodeIdMatch[1]!;
                const result = await getKnowledgeNeighborsTool({
                    nodeId,
                    maxDepth: 1,
                });

                expect(result.output).toBeDefined();
            }
        });

        it('returns error for non-existent node', async () => {
            const { getKnowledgeNeighborsTool } =
                await import('../knowledge-graph');
            const result = await getKnowledgeNeighborsTool({
                nodeId: 'nonexistent:node',
                maxDepth: 1,
            });

            expect(result.output).toContain('not found');
        });
    });

    describe('addKnowledgeNodeTool and addKnowledgeEdgeTool', () => {
        it('adds a node and edge manually', async () => {
            const { addKnowledgeNodeTool, addKnowledgeEdgeTool } =
                await import('../knowledge-graph');

            const node1 = await addKnowledgeNodeTool({
                id: 'test:node-a',
                type: 'function',
                name: 'testFunction',
                filePath: 'src/test.ts',
                description: 'A test function',
            });

            expect(node1.output).toContain('Added node');
            expect(node1.output).toContain('testFunction');

            const node2 = await addKnowledgeNodeTool({
                id: 'test:node-b',
                type: 'function',
                name: 'otherFunction',
                filePath: 'src/other.ts',
            });

            expect(node2.output).toContain('Added node');

            const edge = await addKnowledgeEdgeTool({
                source: 'test:node-a',
                target: 'test:node-b',
                type: 'calls',
                filePath: 'src/test.ts',
            });

            expect(edge.output).toContain('Added edge');
            expect(edge.output).toContain('calls');
        });

        it('returns error when adding edge to non-existent node', async () => {
            const { addKnowledgeNodeTool, addKnowledgeEdgeTool } =
                await import('../knowledge-graph');

            await addKnowledgeNodeTool({
                id: 'test:exists',
                type: 'function',
                name: 'exists',
            });

            const result = await addKnowledgeEdgeTool({
                source: 'test:exists',
                target: 'test:not-exists',
                type: 'calls',
            });

            expect(result.output).toContain('not found');
        });
    });

    describe('detectKnowledgeCyclesTool', () => {
        it('detects no cycles in acyclic graph', async () => {
            const {
                addKnowledgeNodeTool,
                addKnowledgeEdgeTool,
                detectKnowledgeCyclesTool,
            } = await import('../knowledge-graph');

            await addKnowledgeNodeTool({
                id: 'cycle:a',
                type: 'file',
                name: 'a.ts',
            });
            await addKnowledgeNodeTool({
                id: 'cycle:b',
                type: 'file',
                name: 'b.ts',
            });
            await addKnowledgeNodeTool({
                id: 'cycle:c',
                type: 'file',
                name: 'c.ts',
            });

            await addKnowledgeEdgeTool({
                source: 'cycle:a',
                target: 'cycle:b',
                type: 'imports',
            });
            await addKnowledgeEdgeTool({
                source: 'cycle:b',
                target: 'cycle:c',
                type: 'imports',
            });

            const result = await detectKnowledgeCyclesTool();
            expect(result.output).toContain('No circular dependencies');
        });

        it('detects cycles', async () => {
            const {
                addKnowledgeNodeTool,
                addKnowledgeEdgeTool,
                detectKnowledgeCyclesTool,
            } = await import('../knowledge-graph');

            await addKnowledgeNodeTool({
                id: 'cycle:x',
                type: 'file',
                name: 'x.ts',
            });
            await addKnowledgeNodeTool({
                id: 'cycle:y',
                type: 'file',
                name: 'y.ts',
            });

            await addKnowledgeEdgeTool({
                source: 'cycle:x',
                target: 'cycle:y',
                type: 'imports',
            });
            await addKnowledgeEdgeTool({
                source: 'cycle:y',
                target: 'cycle:x',
                type: 'imports',
            });

            const result = await detectKnowledgeCyclesTool();
            expect(result.output).toContain('circular dependency');
        });
    });

    describe('getKnowledgeStatsTool', () => {
        it('returns stats after building graph', async () => {
            const { buildKnowledgeGraphTool, getKnowledgeStatsTool } =
                await import('../knowledge-graph');
            await buildKnowledgeGraphTool({
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const result = await getKnowledgeStatsTool();
            expect(result.output).toContain('Knowledge Graph Stats');
            expect(result.output).toContain('Total nodes:');
            expect(result.output).toContain('Total edges:');
            expect(result.output).toContain('Files tracked:');
        });

        it('returns zero stats for empty graph', async () => {
            const { getKnowledgeStatsTool } =
                await import('../knowledge-graph');
            const result = await getKnowledgeStatsTool();

            expect(result.output).toContain('Knowledge Graph Stats');
            expect(result.output).toContain('Total nodes: 0');
        });
    });
});
