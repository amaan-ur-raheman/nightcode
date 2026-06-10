import { toolInputSchemas } from "@nightcode/shared";
import { runGit } from "./utils";

export async function gitLogTool(input: unknown) {
    const { limit, oneline, author } = toolInputSchemas.gitLog.parse(input);

    try {
        const args = ["log"];
        if (oneline) args.push("--oneline");
        if (author) args.push(`--author=${author}`);
        args.push("-n", String(limit));

        const result = await runGit(process.cwd(), args);
        if (result.exitCode !== 0) {
            return { success: false, commits: [], output: result.stderr || "git log failed" };
        }

        if (!result.stdout.trim()) {
            return { success: true, commits: [], output: "" };
        }

        const commits = result.stdout.split("\n").filter((line: string) => line.trim()).map((line: string) => {
            if (oneline) {
                const match = line.match(/^([0-9a-f]+)\s+(.+)$/);
                return {
                    hash: match?.[1] || "",
                    message: match?.[2] || line,
                };
            }

            const hashMatch = line.match(/^([0-9a-f]{40})\s+(.+?)\s+\((.+?)\s+(\d{4}-\d{2}-\d{2})\)$/);
            if (hashMatch) {
                return {
                    hash: hashMatch[1],
                    message: hashMatch[2],
                    author: hashMatch[3],
                    date: hashMatch[4],
                };
            }

            const shortMatch = line.match(/^([0-9a-f]+)\s+(.+)$/);
            return {
                hash: shortMatch?.[1] || "",
                message: shortMatch?.[2] || line,
            };
        });

        return { success: true, commits };
    } catch (err) {
        return { success: false, commits: [], output: (err as Error).message };
    }
}
