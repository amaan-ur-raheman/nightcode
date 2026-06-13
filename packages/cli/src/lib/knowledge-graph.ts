import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, relative, extname, basename, dirname } from 'path';
import { homedir } from 'os';
import {
    KnowledgeGraph,
    type KnowledgeNode,
    type KnowledgeNodeType,
    type KnowledgeEdge,
    type KnowledgeQuery,
    type KnowledgeStats,
    type KnowledgeNeighbor,
    type ImpactReport,
    type BreakingChangeReport,
    type MigrationStep,
} from '@nightcode/shared';
import { debug } from './debug';

const KG_DIR = join(homedir(), '.nightcode', 'knowledge');
const GRAPH_FILE = join(KG_DIR, 'graph.json');

const SOURCE_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
    '.md',
    '.yaml',
    '.yml',
    '.toml',
    '.prisma',
    '.graphql',
    '.gql',
]);

const IGNORE_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.turbo',
    'coverage',
    '.cache',
    '__pycache__',
    '.DS_Store',
]);

const MAX_FILE_SIZE = 512 * 1024; // 512KB
const MAX_FILES = 5000;
const ALLOWED_DOTFILES = new Set(['.env', '.env.example', '.env.local', '.env.development', '.env.production', '.eslintrc.js', '.prettierrc']);

class KnowledgeGraphManager {
    private graph: KnowledgeGraph | null = null;

    async load(): Promise<KnowledgeGraph> {
        if (this.graph) return this.graph;

        try {
            await mkdir(KG_DIR, { recursive: true });
            const content = await readFile(GRAPH_FILE, 'utf-8');
            const data = JSON.parse(content);
            this.graph = KnowledgeGraph.fromJSON(data);
            debug.log(
                'knowledge-graph',
                `Loaded graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.size} edges`,
            );
        } catch {
            this.graph = new KnowledgeGraph(process.cwd());
        }

        return this.graph;
    }

    async save(): Promise<void> {
        if (!this.graph) return;
        await mkdir(KG_DIR, { recursive: true });
        const data = JSON.stringify(this.graph.toJSON(), null, 2);
        await writeFile(GRAPH_FILE, data, 'utf-8');
        debug.log(
            'knowledge-graph',
            `Saved graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.size} edges`,
        );
    }

    getGraph(): KnowledgeGraph {
        if (!this.graph) {
            this.graph = new KnowledgeGraph(process.cwd());
        }
        return this.graph;
    }

    // ─── Scanning ──────────────────────────────────────────────────────────────

    async buildFromProject(
        projectRoot: string,
        options: { includePatterns?: string[]; excludePatterns?: string[] } = {},
    ): Promise<{
        stats: KnowledgeStats;
        durationMs: number;
        filesScanned: number;
    }> {
        const startTime = Date.now();
        const graph = new KnowledgeGraph(projectRoot);
        let filesScanned = 0;

        const excludePatterns = options.excludePatterns ?? [];
        const includePatterns = options.includePatterns ?? [];

        // Step 1: Discover all source files
        const files = await this.discoverFiles(
            projectRoot,
            includePatterns,
            excludePatterns,
        );
        debug.log('knowledge-graph', `Discovered ${files.length} files`);

        // Step 2: Add file nodes and extract symbols
        for (const filePath of files) {
            if (filesScanned >= MAX_FILES) break;

            try {
                const content = await readFile(filePath, 'utf-8');
                if (content.length > MAX_FILE_SIZE) continue;

                const relPath = relative(projectRoot, filePath);
                const fileId = `file:${relPath}`;
                const ext = extname(filePath).slice(1);

                graph.addNode({
                    id: fileId,
                    type: 'file',
                    name: basename(filePath),
                    filePath: relPath,
                    language: ext,
                    exported: true,
                    metadata: { size: content.length },
                });

                // Extract exports, imports, classes, functions
                await this.extractFromFile(graph, filePath, relPath, fileId, content);

                filesScanned++;
            } catch {
                // Skip unreadable files
            }
        }

        // Step 3: Add config files as nodes
        for (const filePath of files) {
            const relPath = relative(projectRoot, filePath);
            const base = basename(filePath);
            const configFiles = [
                'package.json',
                'tsconfig.json',
                '.env',
                '.env.example',
                'prisma.schema',
                'schema.prisma',
                'Cargo.toml',
                'go.mod',
                'pyproject.toml',
                'requirements.txt',
                'Makefile',
                'Dockerfile',
                'docker-compose.yml',
                'docker-compose.yaml',
                '.eslintrc.js',
                '.prettierrc',
                'vitest.config.ts',
                'vite.config.ts',
                'next.config.js',
                'next.config.mjs',
                'turbo.json',
            ];

            if (configFiles.includes(base)) {
                const fileId = `config:${relPath}`;
                graph.addNode({
                    id: fileId,
                    type: 'config',
                    name: base,
                    filePath: relPath,
                    exported: true,
                });

                // Link config to its file
                graph.addEdge({
                    source: fileId,
                    target: `file:${relPath}`,
                    type: 'configures',
                });
            }
        }

        // Step 4: Extract package.json dependencies
        try {
            const pkgPath = join(projectRoot, 'package.json');
            const pkgContent = await readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(pkgContent);

            const allDeps: Record<string, string> = {
                ...(pkg.dependencies ?? {}),
                ...(pkg.devDependencies ?? {}),
            };

            for (const [name, version] of Object.entries(allDeps)) {
                const depId = `dependency:${name}`;
                graph.addNode({
                    id: depId,
                    type: 'dependency',
                    name,
                    packageName: name,
                    version: version as string,
                    exported: false,
                });

                // Link config to dependency
                graph.addEdge({
                    source: `config:package.json`,
                    target: depId,
                    type: 'depends-on',
                });
            }
        } catch {
            // No package.json
        }

        // Step 5: Extract Prisma schema models
        try {
            const prismaPath = join(projectRoot, 'prisma', 'schema.prisma');
            const prismaContent = await readFile(prismaPath, 'utf-8');
            const modelRegex = /^model\s+(\w+)\s*\{/gm;
            let match;
            while ((match = modelRegex.exec(prismaContent)) !== null) {
                const modelName = match[1]!;
                const modelId = `model:${modelName}`;
                graph.addNode({
                    id: modelId,
                    type: 'type',
                    name: modelName,
                    filePath: 'prisma/schema.prisma',
                    exported: true,
                    metadata: { kind: 'prisma-model' },
                });
            }

            // Also try relative path
            const relPrismaPath = relative(
                projectRoot,
                join(projectRoot, 'packages', 'database', 'prisma', 'schema.prisma'),
            );
            try {
                const altPrismaContent = await readFile(
                    join(projectRoot, 'packages', 'database', 'prisma', 'schema.prisma'),
                    'utf-8',
                );
                let altMatch;
                while ((altMatch = modelRegex.exec(altPrismaContent)) !== null) {
                    const modelName = altMatch[1]!;
                    const modelId = `model:${modelName}`;
                    if (!graph.nodes.has(modelId)) {
                        graph.addNode({
                            id: modelId,
                            type: 'type',
                            name: modelName,
                            filePath: relPrismaPath,
                            exported: true,
                            metadata: { kind: 'prisma-model' },
                        });
                    }
                }
            } catch {
                // No alt prisma
            }
        } catch {
            // No prisma schema
        }

        const durationMs = Date.now() - startTime;
        graph.lastBuilt = Date.now();
        graph.filesScanned = filesScanned;
        graph.buildDurationMs = durationMs;

        this.graph = graph;
        await this.save();

        return {
            stats: graph.getStats(),
            durationMs,
            filesScanned,
        };
    }

    private async discoverFiles(
        dir: string,
        includePatterns: string[],
        excludePatterns: string[],
    ): Promise<string[]> {
        const results: string[] = [];

        const walk = async (currentDir: string): Promise<void> => {
            let entries;
            try {
                entries = await readdir(currentDir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                if (IGNORE_DIRS.has(entry.name)) continue;
                if (entry.name.startsWith('.') && !ALLOWED_DOTFILES.has(entry.name)) continue;

                const fullPath = join(currentDir, entry.name);
                const relPath = relative(dir, fullPath);

                // Check exclude patterns
                if (
                    excludePatterns.some(
                        (p) => relPath.includes(p) || entry.name.includes(p),
                    )
                ) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else if (entry.isFile()) {
                    const ext = extname(entry.name).slice(1);

                    // Check include patterns
                    if (includePatterns.length > 0) {
                        if (!includePatterns.some((p) => entry.name.includes(p) || ext === p)) {
                            continue;
                        }
                    }

                    if (SOURCE_EXTENSIONS.has(`.${ext}`) || entry.name === 'Makefile' || entry.name === 'Dockerfile') {
                        results.push(fullPath);
                    }
                }
            }
        };

        await walk(dir);
        return results;
    }

    private async extractFromFile(
        graph: KnowledgeGraph,
        filePath: string,
        relPath: string,
        fileId: string,
        content: string,
    ): Promise<void> {
        const ext = extname(filePath).slice(1);

        // Extract exports
        const exportDefaultRegex = /^export\s+default\s+/m;
        const namedExportRegex = /^export\s+(?:const|let|var|function|class|interface|type|enum|default)\s+(\w+)/gm;

        let match: RegExpExecArray | null;

        // Named exports (skip 'default' keyword to avoid duplicates)
        while ((match = namedExportRegex.exec(content)) !== null) {
            const name = match[1]!;
            if (name === 'default') continue;
            const nodeId = `${this.getNodeType(name, content, match.index)}:${relPath}#${name}`;
            const lineNum = content.substring(0, match.index).split('\n').length;

            if (!graph.nodes.has(nodeId)) {
                graph.addNode({
                    id: nodeId,
                    type: this.getNodeType(name, content, match.index),
                    name,
                    filePath: relPath,
                    startLine: lineNum,
                    exported: true,
                    language: ext,
                });

                graph.addEdge({
                    source: fileId,
                    target: nodeId,
                    type: 'defines',
                    filePath: relPath,
                    line: lineNum,
                });
            }
        }

        // Default export
        if (exportDefaultRegex.test(content)) {
            const nodeId = `default:${relPath}`;
            if (!graph.nodes.has(nodeId)) {
                graph.addNode({
                    id: nodeId,
                    type: 'function',
                    name: 'default',
                    filePath: relPath,
                    exported: true,
                    language: ext,
                });

                graph.addEdge({
                    source: fileId,
                    target: nodeId,
                    type: 'exports',
                    filePath: relPath,
                });
            }
        }

        // Extract imports — match from '...' patterns (handles multi-line imports)
        const importRegex = /(?:from\s+['"]([^'"]+)['"])/gm;
        while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[1]!;
            const lineNum = content.substring(0, match.index).split('\n').length;

            // Resolve the import target
            const targetFile = this.resolveImport(importPath, relPath);
            if (targetFile) {
                const targetId = `file:${targetFile}`;
                // Only add edge if target exists or create a placeholder
                if (!graph.nodes.has(targetId)) {
                    graph.addNode({
                        id: targetId,
                        type: 'file',
                        name: basename(targetFile),
                        filePath: targetFile,
                        language: extname(targetFile).slice(1),
                    });
                }

                graph.addEdge({
                    source: fileId,
                    target: targetId,
                    type: 'imports',
                    filePath: relPath,
                    line: lineNum,
                });
            } else if (!importPath.startsWith('.')) {
                // External package import
                const depId = `dependency:${importPath}`;
                if (!graph.nodes.has(depId)) {
                    graph.addNode({
                        id: depId,
                        type: 'dependency',
                        name: importPath,
                        packageName: importPath,
                    });
                }

                graph.addEdge({
                    source: fileId,
                    target: depId,
                    type: 'imports',
                    filePath: relPath,
                    line: lineNum,
                });
            }
        }

        // Extract class declarations and their extends/implements
        const classRegex = /^export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,]+))?\s*\{/gm;
        while ((match = classRegex.exec(content)) !== null) {
            const className = match[1]!;
            const extendsClass = match[2];
            const implementsInterfaces = match[3];

            if (extendsClass) {
                const sourceId = `class:${relPath}#${className}`;
                const targetId = `class:*#${extendsClass}`;
                if (graph.nodes.has(sourceId)) {
                    graph.addEdge({
                        source: sourceId,
                        target: targetId,
                        type: 'extends',
                        filePath: relPath,
                    });
                }
            }

            if (implementsInterfaces) {
                const sourceId = `class:${relPath}#${className}`;
                for (const iface of implementsInterfaces.split(',').map((s) => s.trim())) {
                    if (iface) {
                        const targetId = `interface:*#${iface}`;
                        if (graph.nodes.has(sourceId)) {
                            graph.addEdge({
                                source: sourceId,
                                target: targetId,
                                type: 'implements',
                                filePath: relPath,
                            });
                        }
                    }
                }
            }
        }

        // Extract function calls (basic pattern matching)
        const callRegex = /\b(\w+)\s*\(/g;
        const knownSymbols = new Set<string>();
        for (const node of graph.nodes.values()) {
            if (node.filePath === relPath && node.name) {
                knownSymbols.add(node.name);
            }
        }

        let callMatch;
        while ((callMatch = callRegex.exec(content)) !== null) {
            const callName = callMatch[1]!;
            if (
                knownSymbols.has(callName) &&
                !['if', 'for', 'while', 'switch', 'catch', 'return', 'import', 'export', 'new', 'typeof', 'instanceof'].includes(callName)
            ) {
                const lineNum = content.substring(0, callMatch.index).split('\n').length;
                const sourceId = `file:${relPath}`;
                const targetNode = Array.from(graph.nodes.values()).find(
                    (n) => n.name === callName && n.filePath === relPath,
                );
                if (targetNode) {
                    graph.addEdge({
                        source: sourceId,
                        target: targetNode.id,
                        type: 'calls',
                        filePath: relPath,
                        line: lineNum,
                    });
                }
            }
        }

        // Extract JSON file exports
        if (ext === 'json') {
            try {
                const json = JSON.parse(content);
                if (json.exports) {
                    const exportEntries = Array.isArray(json.exports)
                        ? json.exports
                        : typeof json.exports === 'string'
                          ? [json.exports]
                          : [];
                    for (const exp of exportEntries) {
                        if (typeof exp === 'string') {
                            graph.addNode({
                                id: `export:${relPath}#${exp}`,
                                type: 'variable',
                                name: exp,
                                filePath: relPath,
                                exported: true,
                                language: 'json',
                            });
                        }
                    }
                }
            } catch {
                // Not valid JSON
            }
        }

        // Extract TypeScript interface/type declarations
        if (ext === 'ts' || ext === 'tsx') {
            const interfaceRegex = /^export\s+(?:interface|type)\s+(\w+)/gm;
            while ((match = interfaceRegex.exec(content)) !== null) {
                const name = match[1]!;
                const nodeId = `interface:${relPath}#${name}`;
                const lineNum = content.substring(0, match.index).split('\n').length;

                if (!graph.nodes.has(nodeId)) {
                    graph.addNode({
                        id: nodeId,
                        type: 'interface',
                        name,
                        filePath: relPath,
                        startLine: lineNum,
                        exported: true,
                        language: ext,
                    });

                    graph.addEdge({
                        source: fileId,
                        target: nodeId,
                        type: 'defines',
                        filePath: relPath,
                        line: lineNum,
                    });
                }
            }
        }
    }

    private getNodeType(
        name: string,
        content: string,
        offset: number,
    ): KnowledgeNodeType {
        const before = content.substring(Math.max(0, offset - 100), offset);
        if (/class\s*$/.test(before)) return 'class';
        if (/function\s*$/.test(before)) return 'function';
        if (/(?:const|let|var)\s*$/.test(before)) return 'variable';
        if (/interface\s*$/.test(before)) return 'interface';
        if (/type\s*$/.test(before)) return 'type';
        if (/enum\s*$/.test(before)) return 'type';
        return 'function';
    }

    private resolveImport(importPath: string, fromFile: string): string | null {
        if (!importPath.startsWith('.')) return null;
        const dir = dirname(fromFile);
        const target = join(dir, importPath);

        // Normalize: strip trailing /index.tsx? and add no extension (caller handles it)
        return target.replace(/[\\/]+index\.[^.]+$/, '');
    }

    // ─── Public API ─────────────────────────────────────────────────────────────

    async addNode(
        node: Omit<KnowledgeNode, 'createdAt' | 'updatedAt'>,
    ): Promise<KnowledgeNode> {
        const graph = await this.load();
        const result = graph.addNode(node);
        await this.save();
        return result;
    }

    async addEdge(
        edge: Omit<KnowledgeEdge, 'id' | 'createdAt'>,
    ): Promise<KnowledgeEdge> {
        const graph = await this.load();
        const result = graph.addEdge(edge);
        await this.save();
        return result;
    }

    async removeNode(nodeId: string): Promise<boolean> {
        const graph = await this.load();
        const result = graph.removeNode(nodeId);
        if (result) await this.save();
        return result;
    }

    async removeEdge(edgeId: string): Promise<boolean> {
        const graph = await this.load();
        const result = graph.removeEdge(edgeId);
        if (result) await this.save();
        return result;
    }

    async getNeighbors(nodeId: string): Promise<KnowledgeNeighbor[]> {
        const graph = await this.load();
        return graph.getNeighbors(nodeId);
    }

    async query(
        filter: KnowledgeQuery,
    ): Promise<KnowledgeNode[]> {
        const graph = await this.load();
        return graph.query(filter);
    }

    async traverse(
        startNodeId: string,
        maxDepth?: number,
    ): Promise<KnowledgeNode[]> {
        const graph = await this.load();
        return graph.traverse(startNodeId, maxDepth);
    }

    async detectCycles(): Promise<string[][]> {
        const graph = await this.load();
        return graph.detectCycles();
    }

    async getStats(): Promise<KnowledgeStats> {
        const graph = await this.load();
        return graph.getStats();
    }

    async getNode(nodeId: string): Promise<KnowledgeNode | undefined> {
        const graph = await this.load();
        return graph.getNode(nodeId);
    }

    async clear(): Promise<void> {
        this.graph = new KnowledgeGraph(process.cwd());
        await this.save();
    }

    // ─── Impact Analysis ──────────────────────────────────────────────────────

    async assessImpact(nodeId: string): Promise<ImpactReport> {
        const graph = await this.load();
        return graph.assessImpact(nodeId);
    }

    async checkBreakingChange(
        nodeId: string,
        keptExports: string[],
    ): Promise<BreakingChangeReport> {
        const graph = await this.load();
        return graph.checkBreakingChange(nodeId, keptExports);
    }

    async generateMigrationPlan(
        nodeId: string,
        newName?: string,
        newFilePath?: string,
    ): Promise<MigrationStep[]> {
        const graph = await this.load();
        return graph.generateMigrationPlan(nodeId, newName, newFilePath);
    }
}

export const knowledgeGraphManager = new KnowledgeGraphManager();
