import { useState, useEffect } from 'react';

import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { requestQueue, type QueueStats } from '@/lib/request-queue';

export function QueueDialogContent() {
    const { colors } = useTheme();
    const [stats, setStats] = useState<QueueStats>(requestQueue.getStats());

    useEffect(() => {
        const unsubscribe = requestQueue.onStatsChange((newStats) => {
            setStats(newStats);
        });
        return unsubscribe;
    }, []);

    function handleClear() {
        const cleared = requestQueue.clear();
        setStats(requestQueue.getStats());
    }

    return (
        <box flexDirection="column" width="100%">
            <box flexDirection="column" gap={0}>
                <box
                    flexDirection="row"
                    border={['bottom']}
                    borderColor={colors.dimSeparator}
                    paddingBottom={0}
                >
                    <box width={20}>
                        <text
                            attributes={TextAttributes.BOLD}
                            fg={colors.primary}
                        >
                            Metric
                        </text>
                    </box>
                    <box flexGrow={1}>
                        <text
                            attributes={TextAttributes.BOLD}
                            fg={colors.primary}
                        >
                            Value
                        </text>
                    </box>
                </box>
                <box
                    flexDirection="row"
                    border={['bottom']}
                    borderColor={colors.dimSeparator}
                    paddingY={0}
                >
                    <box width={20}>
                        <text fg={colors.dimSeparator}>Pending</text>
                    </box>
                    <box flexGrow={1}>
                        <text fg={colors.text}>{stats.queueSize}</text>
                    </box>
                </box>
                <box
                    flexDirection="row"
                    border={['bottom']}
                    borderColor={colors.dimSeparator}
                    paddingY={0}
                >
                    <box width={20}>
                        <text fg={colors.dimSeparator}>Running</text>
                    </box>
                    <box flexGrow={1}>
                        <text fg={colors.text}>{stats.running}</text>
                    </box>
                </box>
                <box
                    flexDirection="row"
                    border={['bottom']}
                    borderColor={colors.dimSeparator}
                    paddingY={0}
                >
                    <box width={20}>
                        <text fg={colors.dimSeparator}>Rate Limited</text>
                    </box>
                    <box flexGrow={1}>
                        <text
                            fg={
                                stats.rateLimited
                                    ? colors.error
                                    : colors.success
                            }
                        >
                            {stats.rateLimited ? 'yes' : 'no'}
                        </text>
                    </box>
                </box>
                {stats.rateLimited && (
                    <box
                        flexDirection="row"
                        border={['bottom']}
                        borderColor={colors.dimSeparator}
                        paddingY={0}
                    >
                        <box width={20}>
                            <text fg={colors.dimSeparator}>Resets at</text>
                        </box>
                        <box flexGrow={1}>
                            <text fg={colors.text}>
                                {new Date(
                                    stats.rateLimitReset,
                                ).toLocaleTimeString()}
                            </text>
                        </box>
                    </box>
                )}
            </box>

            {stats.queueSize > 0 && (
                <box marginTop={1}>
                    <text fg={colors.error} onMouseDown={handleClear}>
                        [Clear Queue]
                    </text>
                </box>
            )}
        </box>
    );
}
