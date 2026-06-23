import React, { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

import {
    getTaskList,
    onTaskListChange,
    type TaskListState,
} from '@/lib/tools/task-list';

function ProgressBar({
    completed,
    total,
    colors,
}: {
    completed: number;
    total: number;
    colors: any;
}) {
    return (
        <box>
            <text fg={colors.dimSeparator}>
                {' '}
                {completed}/{total}
            </text>
        </box>
    );
}

export const TaskListPanel = React.memo(function TaskListPanel() {
    const { colors } = useTheme();
    const [taskList, setTaskList] = useState<TaskListState | null>(
        getTaskList(),
    );

    useEffect(() => {
        return onTaskListChange(() => {
            setTaskList(getTaskList());
        });
    }, []);

    if (!taskList || taskList.tasks.length === 0) return null;

    const { tasks } = taskList;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const total = tasks.length;

    return (
        <box
            flexDirection="column"
            gap={0}
            paddingLeft={3}
            paddingRight={3}
            width="100%"
        >
            <box
                flexDirection="column"
                backgroundColor={colors.surface}
                width="100%"
                paddingX={1}
                paddingY={1}
            >
                <box
                    flexDirection="row"
                    gap={1}
                    alignItems="center"
                    width="100%"
                >
                    <text attributes={TextAttributes.BOLD}>Task List</text>
                    <ProgressBar
                        completed={completed}
                        total={total}
                        colors={colors}
                    />
                </box>
                {tasks.map((task) => {
                    const symbol =
                        task.status === 'completed'
                            ? '✓'
                            : task.status === 'in-progress'
                              ? '◉'
                              : task.status === 'failed'
                                ? '✗'
                                : '○';

                    const statusColor =
                        task.status === 'completed'
                            ? colors.success
                            : task.status === 'in-progress'
                              ? colors.info
                              : task.status === 'failed'
                                ? colors.error
                                : colors.dimSeparator;

                    const statusLabel =
                        task.status === 'completed'
                            ? 'done'
                            : task.status === 'in-progress'
                              ? 'current'
                              : task.status === 'failed'
                                ? 'failed'
                                : '';

                    return (
                        <box
                            key={task.id}
                            flexDirection="row"
                            gap={1}
                            width="100%"
                        >
                            <text fg={statusColor}>{symbol}</text>
                            <text>{task.id}.</text>
                            <text>{task.description}</text>
                            {statusLabel && (
                                <text
                                    attributes={TextAttributes.DIM}
                                    fg={statusColor}
                                >
                                    ({statusLabel})
                                </text>
                            )}
                        </box>
                    );
                })}
            </box>
        </box>
    );
});
