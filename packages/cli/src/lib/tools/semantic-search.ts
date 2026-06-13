import { toolInputSchemas } from '@nightcode/shared';
import { searchIndex } from '@/lib/search-index';
import { knowledgeGraphManager } from '@/lib/knowledge-graph';

export async function semanticSearchTool(input: unknown) {
    const { query, nodeType, limit, filePath } =
        toolInputSchemas.semanticSearch.parse(input);

    // Ensure the search index is built and up-to-date
    const graph = knowledgeGraphManager.getGraph();

    if (searchIndex.size === 0 || searchIndex.isStale(graph.lastBuilt)) {
        // Rebuild from the graph
        if (graph.nodes.size === 0) {
            // No graph built yet — try to load persisted graph first
            try {
                await knowledgeGraphManager.load();
                const loadedGraph = knowledgeGraphManager.getGraph();
                searchIndex.buildFromGraph(loadedGraph);
                await searchIndex.save();
            } catch {
                return {
                    error: 'No knowledge graph available. Run buildKnowledgeGraph first to scan the project.',
                };
            }
        } else {
            searchIndex.buildFromGraph(graph);
            await searchIndex.save();
        }
    }

    const results = searchIndex.search(query, {
        nodeType,
        limit,
        filePath,
    });

    if (results.length === 0) {
        return {
            query,
            results: [],
            message: `No results found for "${query}". Try a different query or check spelling.`,
        };
    }

    return {
        query,
        totalResults: results.length,
        results: results.map((r) => ({
            name: r.node.name,
            type: r.node.type,
            filePath: r.node.filePath ?? 'unknown',
            line: r.node.startLine,
            exported: r.node.exported,
            description: r.node.description,
            score: r.score,
            matchType: r.matchType,
            matchedToken: r.matchedToken,
        })),
        hint:
            results.length === (limit ?? 20)
                ? 'Results were limited. Increase limit or add filters for more specific results.'
                : undefined,
    };
}
