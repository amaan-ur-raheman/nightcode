import { z } from "zod";
import { tool } from "ai";
import { resolve, relative } from "path";

const MAX_RESULT = 200;

export function createGlobTool(cwd: string) {
    return tool({
        description:
            "Find files matching a glob pattern. Returns file paths relative to the project root. Skips node_modules and hidden directories.",
        inputSchema: z.object({
            pattern: z.string().describe("Glob pattern to match (e.g. '**/*.ts', src/**/*.tsx)"),
            path: z
                .string()
                .describe("Relative directory to search (defaults to project root)")
                .default(".")
        }),
        execute: async ({ pattern, path }) => {
            const resolved = resolve(cwd, path);

            if (!resolved.startsWith(cwd)) {
                return { error: "Path is outside the project directory" };
            }

            try {
                const glob = new Bun.Glob(pattern);
                const files: string[] = [];
                let truncated = false;

                for await (const match of glob.scan({
                    cwd: resolved,
                    dot: false,
                    onlyFiles: true,
                })) {
                    // Skip the node_modules matches
                    if (match.includes("node_modules")) continue;

                    if (files.length >= MAX_RESULT) {
                        truncated = true;
                        break;
                    }

                    // Return paths relative to the project root
                    const absoluteMatch = resolve(resolved, match);
                    files.push(relative(cwd, absoluteMatch));
                }

                files.sort();
                return {
                    files,
                    ...(truncated ? { truncated: true } : {})
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to execute the glob: ${message}` };
            }
        },
    })
}
