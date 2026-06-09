import { relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { IGNORE, MAX_MATCHES, resolveInsideCwd } from "./utils";

export async function grepTool(input: unknown, _parentMode?: string, _parentModel?: string, signal?: AbortSignal) {
    const { pattern, path, include } = toolInputSchemas.grep.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const args = ["-rn", "--color=never", "--binary-files=without-match", "-E"];
    for (const dir of IGNORE) {
        args.push(`--exclude-dir=${dir}`);
    }
    if (include) args.push(`--include=${include}`);
    args.push(pattern, resolved);

    const proc = Bun.spawn(["grep", ...args], { cwd, stdout: "pipe", stderr: "pipe" });

    const onAbort = () => proc.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort);

    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    signal?.removeEventListener("abort", onAbort);

    if (exitCode !== 0 && exitCode !== 1) throw new Error(`grep failed: ${stderr.trim()}`);
    if (!stdout.trim()) return { matches: [], message: "No matches found" };

    const lines = stdout.trim().split("\n");
    const matches: { file: string; line: number; content: string }[] = [];
    let totalMatches = 0;
    let truncated = false;

    for (const line of lines) {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (!match) continue;
        totalMatches++;
        if (matches.length >= MAX_MATCHES) { truncated = true; continue; }
        matches.push({ file: relative(cwd, match[1]!), line: Number(match[2]), content: match[3]! });
    }

    return { matches, ...(truncated ? { truncated: true, totalMatches } : {}) };
}
