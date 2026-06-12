import { useState, useEffect } from 'react';

import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { snapshotManager, type SnapshotEntry } from '@/lib/snapshot-manager';

export function SnapshotDialogContent() {
    const { colors } = useTheme();
    const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSnapshots();
    }, []);

    async function loadSnapshots() {
        setLoading(true);
        const data = await snapshotManager.list();
        setSnapshots(data);
        setLoading(false);
    }

    async function handleClearAll() {
        await snapshotManager.clear();
        setSnapshots([]);
    }

    async function handleDelete(name: string) {
        await snapshotManager.delete(name);
        setSnapshots((prev) => prev.filter((s) => s.name !== name));
    }

    if (loading) {
        return (
            <box padding={2}>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    Loading...
                </text>
            </box>
        );
    }

    return (
        <box flexDirection="column" width="100%">
            <box
                flexDirection="row"
                gap={2}
                alignItems="center"
                marginBottom={1}
            >
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    {snapshots.length} snapshot(s)
                </text>
                {snapshots.length > 0 && (
                    <text fg={colors.error} onMouseDown={handleClearAll}>
                        [Clear All]
                    </text>
                )}
            </box>

            {snapshots.length === 0 ? (
                <box padding={1}>
                    <text fg={colors.dimSeparator}>No snapshots stored</text>
                </box>
            ) : (
                <scrollbox height={10}>
                    {snapshots.map((s, i) => (
                        <box
                            key={i}
                            flexDirection="row"
                            border={['bottom']}
                            borderColor={colors.dimSeparator}
                            paddingY={0}
                        >
                            <box flexGrow={1}>
                                <text fg={colors.text}>{s.name}</text>
                            </box>
                            <box width={20}>
                                <text fg={colors.dimSeparator}>
                                    {new Date(s.createdAt).toLocaleDateString()}
                                </text>
                            </box>
                            <box width={8} alignItems="center">
                                <text
                                    fg={colors.error}
                                    onMouseDown={() => handleDelete(s.name)}
                                >
                                    [del]
                                </text>
                            </box>
                        </box>
                    ))}
                </scrollbox>
            )}
        </box>
    );
}
