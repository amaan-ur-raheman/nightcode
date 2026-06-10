import { toolInputSchemas } from "@nightcode/shared";
import { runGit } from "./utils";

export async function gitCommitTool(input: unknown) {
    const { message, files } = toolInputSchemas.gitCommit.parse(input);

    try {
        if (files && files.length > 0) {
            const addResult = await runGit(process.cwd(), ["add", ...files]);
            if (addResult.exitCode !== 0) {
                return { success: false, output: addResult.stderr || "git add failed" };
            }
        }

        const result = await runGit(process.cwd(), ["commit", "-m", message]);
        if (result.exitCode !== 0) {
            return { success: false, output: result.stderr || result.stdout || "git commit failed" };
        }

        const hashMatch = result.stdout.match(/\[[\w]+\s+([0-9a-f]+)\]/);
        const commitHash = hashMatch ? hashMatch[1] : undefined;

        return { success: true, output: result.stdout, commitHash };
    } catch (err) {
        return { success: false, output: (err as Error).message };
    }
}
