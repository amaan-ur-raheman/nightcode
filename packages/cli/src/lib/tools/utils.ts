import { isAbsolute, relative, resolve } from "path";

export const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage"]);

export const MAX_FILE_SIZE = 10_000;
export const MAX_RESULTS = 200;
export const MAX_MATCHES = 50;
export const MAX_OUTPUT = 20_000;
export const MAX_TREE_LINES = 500;
export const MAX_DIFF = 20_000;
export const MAX_PATCH_SIZE = 200_000;
export const MAX_TEST_OUTPUT = 30_000;

export function resolveInsideCwd(path: string) {
    const cwd = process.cwd();
    const resolved = resolve(cwd, path);
    const rel = relative(cwd, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("Path is outside the project directory");
    }
    return { cwd, resolved };
}

export function truncate(value: string, limit: number) {
    return value.length > limit
        ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
        : value;
}

export async function runGit(cwd: string, args: string[]) {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: await proc.exited };
}
