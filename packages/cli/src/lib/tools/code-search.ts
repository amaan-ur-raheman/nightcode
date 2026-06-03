import { relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { MAX_MATCHES, resolveInsideCwd } from "./utils";

export async function codeSearchTool(input: unknown) {
    const { symbol, path, include } = toolInputSchemas.codeSearch.parse(input);
    const { cwd, resolved } = resolveInsideCwd(path);
    const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        `(function|async function)\\s+${s}\\s*\\(`,
        `(const|let|var)\\s+${s}\\s*=\\s*(async\\s+)?\\(`,
        `(const|let|var)\\s+${s}\\s*=\\s*(async\\s+)?function`,
        `class\\s+${s}(\\s|\\{|extends)`,
        `(export\\s+)?(default\\s+)?(function|class|const|let|var)\\s+${s}[\\s\\(=<{]`,
        `${s}\\s*:\\s*(function|\\()`,
        `def\\s+${s}\\s*\\(`,
        `func\\s+${s}\\s*\\(`,
        `fn\\s+${s}\\s*\\(`,
    ];
    const args = ["-rn", "--color=never", "--exclude-dir=node_modules", "--exclude-dir=.git", "--binary-files=without-match", "-E", patterns.join("|")];
    if (include) args.push(`--include=${include}`);
    args.push(resolved);

    const proc = Bun.spawn(["grep", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;

    if (exitCode !== 0 && exitCode !== 1) return { error: `Search failed: ${stderr.trim()}` };
    if (!stdout.trim()) return { matches: [], message: "No definitions found" };

    const lines = stdout.trim().split("\n");
    const matches: { file: string; line: number; content: string }[] = [];
    let truncated = false;

    for (const line of lines) {
        if (matches.length >= MAX_MATCHES) { truncated = true; break; }
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) matches.push({ file: relative(cwd, match[1]!), line: Number(match[2]), content: match[3]!.trim() });
    }

    return { matches, ...(truncated ? { truncated: true } : {}) };
}
