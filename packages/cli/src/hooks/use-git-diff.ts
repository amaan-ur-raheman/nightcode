import { useState, useEffect, useRef } from 'react';
import { readFile } from 'fs/promises';
import { runGit } from '@/lib/tools/utils';

type UseGitDiffResult = {
    diffText: string | null;
    loading: boolean;
    error: string | null;
};

export function useGitDiff(filePath: string | undefined): UseGitDiffResult {
    const [diffText, setDiffText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef(0);

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (!filePath) {
            setDiffText(null);
            setLoading(false);
            setError(null);
            return;
        }

        const runId = ++abortRef.current;

        timerRef.current = setTimeout(() => {
            let cancelled = false;

            (async () => {
                setLoading(true);
                setError(null);
                setDiffText(null);

                try {
                    const cwd = process.cwd();

                    // Try git diff first
                    const diffResult = await runGit(cwd, [
                        'diff',
                        '--',
                        filePath,
                    ]);

                    if (cancelled) return;

                    if (diffResult.exitCode === 0 && diffResult.stdout) {
                        setDiffText(diffResult.stdout);
                        setLoading(false);
                        return;
                    }

                    // File might be untracked — check
                    const lsResult = await runGit(cwd, [
                        'ls-files',
                        '--error-unmatch',
                        filePath,
                    ]);

                    if (cancelled) return;

                    if (lsResult.exitCode !== 0) {
                        // Untracked file — show full content as additions
                        try {
                            const content = await readFile(filePath, 'utf-8');
                            if (cancelled) return;

                            const relativePath = filePath.startsWith(cwd)
                                ? filePath.slice(cwd.length + 1)
                                : filePath;
                            const lines = content.split('\n');
                            const added = lines.map((l) => `+${l}`).join('\n');
                            const diff = `--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1,${lines.length} @@\n${added}`;
                            setDiffText(diff);
                        } catch {
                            setDiffText(null);
                            setError('Could not read file');
                        }
                        setLoading(false);
                        return;
                    }

                    // Tracked but no diff — file is clean
                    setDiffText(null);
                    setLoading(false);
                } catch (err) {
                    if (cancelled) return;
                    setError(
                        err instanceof Error
                            ? err.message
                            : 'Failed to get git diff',
                    );
                    setLoading(false);
                }
            })();

            return () => {
                cancelled = true;
            };
        }, 300);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [filePath]);

    return { diffText, loading, error };
}
