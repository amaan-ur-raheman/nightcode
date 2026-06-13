import { describe, it, expect, beforeEach } from 'vitest';
import { SearchIndex } from '../search-index';
import { KnowledgeGraph } from '@nightcode/shared';

function createTestGraph(): KnowledgeGraph {
    const graph = new KnowledgeGraph('/test/project');
    graph.lastBuilt = Date.now();

    // Add file nodes
    graph.addNode({
        id: 'file:src/auth.ts',
        type: 'file',
        name: 'auth.ts',
        filePath: 'src/auth.ts',
        exported: true,
    });
    graph.addNode({
        id: 'file:src/utils.ts',
        type: 'file',
        name: 'utils.ts',
        filePath: 'src/utils.ts',
        exported: true,
    });

    // Add function nodes
    graph.addNode({
        id: 'function:src/auth.ts#authenticateUser',
        type: 'function',
        name: 'authenticateUser',
        filePath: 'src/auth.ts',
        startLine: 10,
        exported: true,
        description: 'Validates user credentials and returns a session token',
    });
    graph.addNode({
        id: 'function:src/auth.ts#validateToken',
        type: 'function',
        name: 'validateToken',
        filePath: 'src/auth.ts',
        startLine: 30,
        exported: true,
    });
    graph.addNode({
        id: 'function:src/utils.ts#formatDate',
        type: 'function',
        name: 'formatDate',
        filePath: 'src/utils.ts',
        startLine: 5,
        exported: true,
    });

    // Add class node
    graph.addNode({
        id: 'class:src/auth.ts#AuthService',
        type: 'class',
        name: 'AuthService',
        filePath: 'src/auth.ts',
        startLine: 50,
        exported: true,
        description: 'Main authentication service',
    });

    // Add interface node
    graph.addNode({
        id: 'interface:src/auth.ts#AuthConfig',
        type: 'interface',
        name: 'AuthConfig',
        filePath: 'src/auth.ts',
        startLine: 1,
        exported: true,
    });

    // Add variable node
    graph.addNode({
        id: 'variable:src/auth.ts#MAX_SESSIONS',
        type: 'variable',
        name: 'MAX_SESSIONS',
        filePath: 'src/auth.ts',
        startLine: 2,
        exported: false,
    });

    // Add dependency node
    graph.addNode({
        id: 'dependency:bcrypt',
        type: 'dependency',
        name: 'bcrypt',
        packageName: 'bcrypt',
        version: '5.1.0',
    });

    // Add type node
    graph.addNode({
        id: 'type:src/utils.ts#User',
        type: 'type',
        name: 'User',
        filePath: 'src/utils.ts',
        startLine: 20,
        exported: true,
    });

    return graph;
}

describe('SearchIndex', () => {
    let index: SearchIndex;

    beforeEach(() => {
        index = new SearchIndex();
        const graph = createTestGraph();
        index.buildFromGraph(graph);
    });

    it('builds from graph and indexes non-file nodes', () => {
        expect(index.size).toBe(8); // 8 non-file nodes
    });

    it('finds exact name matches', () => {
        const results = index.search('authenticateUser');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.node.name).toBe('authenticateUser');
        expect(results[0]!.matchType).toBe('exact');
    });

    it('finds prefix matches', () => {
        const results = index.search('auth');
        expect(results.length).toBeGreaterThan(0);
        const names = results.map((r) => r.node.name);
        expect(names).toContain('authenticateUser');
        expect(names).toContain('AuthService');
        expect(names).toContain('AuthConfig');
    });

    it('finds substring matches', () => {
        const results = index.search('token');
        expect(results.length).toBeGreaterThan(0);
        const names = results.map((r) => r.node.name);
        expect(names).toContain('validateToken');
    });

    it('finds fuzzy matches for typos', () => {
        // "athenticateUser" is one edit away from "authenticateUser"
        const results = index.search('athenticateUser');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.node.name).toBe('authenticateUser');
    });

    it('filters by node type', () => {
        const results = index.search('auth', { nodeType: 'class' });
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
            expect(r.node.type).toBe('class');
        }
    });

    it('filters by file path', () => {
        const results = index.search('auth', { filePath: 'utils' });
        // Should only return results from utils.ts
        for (const r of results) {
            expect(r.node.filePath).toContain('utils');
        }
    });

    it('respects limit parameter', () => {
        const results = index.search('a', { limit: 2 });
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it('ranks exact matches higher than prefix', () => {
        const results = index.search('formatDate');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.node.name).toBe('formatDate');
        expect(results[0]!.matchType).toBe('exact');
    });

    it('finds type nodes', () => {
        const results = index.search('User');
        expect(results.length).toBeGreaterThan(0);
        const userResult = results.find((r) => r.node.name === 'User');
        expect(userResult).toBeDefined();
        expect(userResult!.node.type).toBe('type');
    });

    it('finds dependency nodes', () => {
        const results = index.search('bcrypt');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.node.type).toBe('dependency');
    });

    it('searches by description content', () => {
        // "credentials" is in the description of authenticateUser
        const results = index.search('credentials');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.node.name).toBe('authenticateUser');
    });

    it('returns empty array for no matches', () => {
        const results = index.search('zzzznonexistent');
        expect(results).toEqual([]);
    });

    it('finds node type token matches', () => {
        const results = index.search('interface');
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
            expect(r.node.type).toBe('interface');
        }
    });

    it('gracefully handles extremely long query tokens without crashing or causing OOM', () => {
        const longQuery = 'a'.repeat(1001);
        const results = index.search(longQuery);
        expect(results).toEqual([]);
    });
});
