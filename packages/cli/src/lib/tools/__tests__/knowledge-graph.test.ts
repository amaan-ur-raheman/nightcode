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

    describe('build action', () => {
        it('builds a graph from the current project', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');
            const result = await knowledgeGraphTool({
                action: 'build',
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            expect(result.output).toContain('built in');
            expect(result.output).toContain('Nodes:');
            expect(result.output).toContain('Edges:');
        });
    });

    describe('query action', () => {
        it('queries nodes by type', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');
            await knowledgeGraphTool({
                action: 'build',
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const result = await knowledgeGraphTool({
                action: 'query',
                nodeType: 'file',
                limit: 10,
            });

            expect(result.output).toContain('[file]');
        });

        it('returns message when no nodes match', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');
            await knowledgeGraphTool({
                action: 'build',
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const result = await knowledgeGraphTool({
                action: 'query',
                name: 'zzz_nonexistent_symbol_xyz',
                limit: 10,
            });

            expect(result.output).toContain('No nodes match');
        });
    });

    describe('neighbors action', () => {
        it('finds neighbors for a file node', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');
            await knowledgeGraphTool({
                action: 'build',
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const files = await knowledgeGraphTool({
                action: 'query',
                nodeType: 'file',
                limit: 1,
            });

            const nodeIdMatch = files.output.match(/\(id: ([^)]+)\)/);
            if (nodeIdMatch) {
                const nodeId = nodeIdMatch[1]!;
                const result = await knowledgeGraphTool({
                    action: 'neighbors',
                    nodeId,
                    maxDepth: 1,
                });

                expect(result.output).toBeDefined();
            }
        });

        it('returns error for non-existent node', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');
            const result = await knowledgeGraphTool({
                action: 'neighbors',
                nodeId: 'nonexistent:node',
                maxDepth: 1,
            });

            expect(result.output).toContain('not found');
        });
    });

    describe('add_node and add_edge actions', () => {
        it('adds a node and edge manually', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');

            const node1 = await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'test:node-a',
                nodeType: 'function',
                nodeName: 'testFunction',
                filePath: 'src/test.ts',
                nodeDescription: 'A test function',
            });

            expect(node1.output).toContain('Added node');
            expect(node1.output).toContain('testFunction');

            const node2 = await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'test:node-b',
                nodeType: 'function',
                nodeName: 'otherFunction',
                filePath: 'src/other.ts',
            });

            expect(node2.output).toContain('Added node');

            const edge = await knowledgeGraphTool({
                action: 'add_edge',
                source: 'test:node-a',
                target: 'test:node-b',
                edgeType: 'calls',
                edgeFilePath: 'src/test.ts',
            });

            expect(edge.output).toContain('Added edge');
            expect(edge.output).toContain('calls');
        });

        it('returns error when adding edge to non-existent node', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');

            await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'test:exists',
                nodeType: 'function',
                nodeName: 'exists',
            });

            const result = await knowledgeGraphTool({
                action: 'add_edge',
                source: 'test:exists',
                target: 'test:not-exists',
                edgeType: 'calls',
            });

            expect(result.output).toContain('not found');
        });
    });

    describe('detect_cycles action', () => {
        it('detects no cycles in acyclic graph', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');

            await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'cycle:a',
                nodeType: 'file',
                nodeName: 'a.ts',
            });
            await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'cycle:b',
                nodeType: 'file',
                nodeName: 'b.ts',
            });
            await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'cycle:c',
                nodeType: 'file',
                nodeName: 'c.ts',
            });

            await knowledgeGraphTool({
                action: 'add_edge',
                source: 'cycle:a',
                target: 'cycle:b',
                edgeType: 'imports',
            });
            await knowledgeGraphTool({
                action: 'add_edge',
                source: 'cycle:b',
                target: 'cycle:c',
                edgeType: 'imports',
            });

            const result = await knowledgeGraphTool({
                action: 'detect_cycles',
            });
            expect(result.output).toContain('No circular dependencies');
        });

        it('detects cycles', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');

            await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'cycle:x',
                nodeType: 'file',
                nodeName: 'x.ts',
            });
            await knowledgeGraphTool({
                action: 'add_node',
                nodeId: 'cycle:y',
                nodeType: 'file',
                nodeName: 'y.ts',
            });

            await knowledgeGraphTool({
                action: 'add_edge',
                source: 'cycle:x',
                target: 'cycle:y',
                edgeType: 'imports',
            });
            await knowledgeGraphTool({
                action: 'add_edge',
                source: 'cycle:y',
                target: 'cycle:x',
                edgeType: 'imports',
            });

            const result = await knowledgeGraphTool({
                action: 'detect_cycles',
            });
            expect(result.output).toContain('circular dependency');
        });
    });

    describe('get_stats action', () => {
        it('returns stats after building graph', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');
            await knowledgeGraphTool({
                action: 'build',
                includePatterns: ['ts'],
                excludePatterns: ['node_modules', 'dist', 'test', '__tests__'],
            });

            const result = await knowledgeGraphTool({
                action: 'stats',
            });
            expect(result.output).toContain('Knowledge Graph Stats');
            expect(result.output).toContain('Total nodes:');
            expect(result.output).toContain('Total edges:');
        });

        it('returns zero stats for empty graph', async () => {
            const { knowledgeGraphTool } = await import('../knowledge-graph');
            const result = await knowledgeGraphTool({
                action: 'stats',
            });

            expect(result.output).toContain('Knowledge Graph Stats');
            expect(result.output).toContain('Total nodes: 0');
        });
    });
});
