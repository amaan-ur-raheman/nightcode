import { useState } from "react";
import { executeLocalTool } from "@/lib/local-tools";
import { useDialog } from "@/providers/dialog";
import { useTheme } from "@/providers/theme";
import { TextAttributes } from "@opentui/core";

interface ChangeEntry {
    file: string;
    replacements: number;
    lines: number[];
}

export function RenameDialogContent() {
    const { colors } = useTheme();
    const { close: closeDialog } = useDialog();
    const [oldName, setOldName] = useState("");
    const [newName, setNewName] = useState("");
    const [globPattern, setGlobPattern] = useState("**/*.{ts,tsx,js,jsx}");
    const [result, setResult] = useState<{
        filesChanged: number;
        totalMatches: number;
        dryRun: boolean;
        changes: ChangeEntry[];
        diff: string;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleRename = async (apply: boolean) => {
        if (!oldName.trim() || !newName.trim()) {
            setError("Both names are required.");
            return;
        }
        setLoading(true);
        setError(null);

        try {
            const output = await executeLocalTool(
                "renameSymbol",
                {
                    oldName: oldName.trim(),
                    newName: newName.trim(),
                    glob: globPattern,
                    dryRun: !apply,
                },
                "BUILD",
            );
            const data = output as {
                filesChanged: number;
                totalMatches: number;
                dryRun: boolean;
                changes: ChangeEntry[];
                diff: string;
            };
            setResult(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Rename failed");
        } finally {
            setLoading(false);
        }
    };

    if (result && !result.dryRun) {
        return (
            <box flexDirection="column" gap={1}>
                <text fg={colors.success} attributes={TextAttributes.BOLD}>
                    ✓ Renamed {result.totalMatches} occurrence(s) across {result.filesChanged} file(s)
                </text>
                <scrollbox height={8}>
                    {result.changes.map((c) => (
                        <text key={c.file} fg={colors.text}>
                            {c.file}: {c.replacements} replacement(s) at lines {c.lines.join(", ")}
                        </text>
                    ))}
                </scrollbox>
            </box>
        );
    }

    const canSubmit = !loading && oldName.trim() !== "" && newName.trim() !== "";

    return (
        <box flexDirection="column" gap={1} width="100%">
            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>Old name:</text>
                <box border={["bottom", "left", "right", "top"]} borderColor={colors.dimSeparator} paddingX={1}>
                    <input
                        value={oldName}
                        onChange={setOldName}
                        placeholder="e.g. myFunction"
                    />
                </box>
            </box>

            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>New name:</text>
                <box border={["bottom", "left", "right", "top"]} borderColor={colors.dimSeparator} paddingX={1}>
                    <input
                        value={newName}
                        onChange={setNewName}
                        placeholder="e.g. renamedFunction"
                    />
                </box>
            </box>

            <box flexDirection="column" gap={0}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>Glob pattern:</text>
                <box border={["bottom", "left", "right", "top"]} borderColor={colors.dimSeparator} paddingX={1}>
                    <input
                        value={globPattern}
                        onChange={setGlobPattern}
                    />
                </box>
            </box>

            <box flexDirection="row" gap={2} marginTop={1}>
                <text
                    fg={canSubmit ? colors.primary : colors.dimSeparator}
                    onMouseDown={() => { if (canSubmit) handleRename(false); }}
                >
                    {loading ? "[Running...]" : "[🔍 Preview (dry run)]"}
                </text>
                <text
                    fg={canSubmit ? colors.error : colors.dimSeparator}
                    onMouseDown={() => { if (canSubmit) handleRename(true); }}
                >
                    {loading ? "[Running...]" : "[✏️ Apply Rename]"}
                </text>
            </box>

            {error && (
                <text fg={colors.error} marginTop={1}>
                    {error}
                </text>
            )}

            {result && result.dryRun && (
                <box flexDirection="column" gap={0} marginTop={1}>
                    {result.filesChanged === 0 ? (
                        <text fg={colors.dimSeparator}>
                            No occurrences of "{oldName}" found.
                        </text>
                    ) : (
                        <box flexDirection="column" gap={0}>
                            <text fg={colors.success} attributes={TextAttributes.BOLD} marginBottom={1}>
                                📋 Preview: {result.totalMatches} occurrence(s) in {result.filesChanged} file(s)
                            </text>
                            <scrollbox height={6}>
                                {result.changes.map((c) => (
                                    <text key={c.file} fg={colors.text}>
                                        <text fg={colors.primary}>{c.file}</text>
                                        {" — "}{c.replacements}{" at lines " }
                                        <text fg={colors.primary}>{c.lines.join(", ")}</text>
                                    </text>
                                ))}
                            </scrollbox>
                            <text fg={colors.dimSeparator} marginTop={1}>
                                Click "Apply Rename" to execute changes.
                            </text>
                        </box>
                    )}
                    {result.diff && (
                        <box flexDirection="column" gap={0} marginTop={1}>
                            <text attributes={TextAttributes.BOLD} fg={colors.primary}>Diff:</text>
                            <scrollbox height={8}>
                                <text fg={colors.text}>{result.diff}</text>
                            </scrollbox>
                        </box>
                    )}
                </box>
            )}
        </box>
    );
}
