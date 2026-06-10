import { runGit } from "./utils";

export async function gitStatusExtendedTool() {
    const cwd = process.cwd();

    try {
        const statusResult = await runGit(cwd, ["status", "--porcelain=v1"]);
        if (statusResult.exitCode !== 0) {
            return { success: false, staged: [], unstaged: [], untracked: [], currentBranch: "", output: statusResult.stderr || "git status failed" };
        }

        const branchResult = await runGit(cwd, ["branch", "--show-current"]);
        const currentBranch = branchResult.stdout.trim();

        const staged: string[] = [];
        const unstaged: string[] = [];
        const untracked: string[] = [];

        for (const line of statusResult.stdout.split("\n")) {
            if (!line.trim()) continue;
            const indexStatus = line[0];
            const workTreeStatus = line[1];
            const filePath = line.substring(3).trim();

            if (indexStatus === "?" && workTreeStatus === "?") {
                untracked.push(filePath);
            } else {
                if (indexStatus !== " " && indexStatus !== "?") {
                    staged.push(filePath);
                }
                if (workTreeStatus !== " " && workTreeStatus !== "?") {
                    unstaged.push(filePath);
                }
            }
        }

        return { success: true, staged, unstaged, untracked, currentBranch };
    } catch (err) {
        return { success: false, staged: [], unstaged: [], untracked: [], currentBranch: "", output: (err as Error).message };
    }
}
