import { toolInputSchemas } from "@nightcode/shared";
import { MAX_DIFF, resolveInsideCwd } from "./utils";

export async function diffFilesTool(input: unknown) {
    const { pathA, pathB } = toolInputSchemas.diffFiles.parse(input);
    const { resolved: resolvedA } = resolveInsideCwd(pathA);
    const { cwd, resolved: resolvedB } = resolveInsideCwd(pathB);

    const proc = Bun.spawn(["diff", "-u", resolvedA, resolvedB], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;

    if (exitCode === 2) return { error: stderr.trim() };
    if (exitCode === 0) return { diff: "", identical: true };

    const diff = stdout;
    return {
        diff: diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) + `\n...(truncated, ${diff.length} total chars)` : diff,
        ...(diff.length > MAX_DIFF ? { truncated: true } : {}),
    };
}
