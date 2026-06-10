import React from "react";

import { useTheme } from "@/providers/theme";
import { TextAttributes } from "@opentui/core";

import type { ConfirmationManager, ConfirmationRequest } from "@/lib/tools/dangerous-ops";

interface ToolConfirmationOverlayProps {
    manager: ConfirmationManager;
}

export function ToolConfirmationOverlay({ manager }: ToolConfirmationOverlayProps) {
    const { colors } = useTheme();
    const [requests, setRequests] = React.useState<ConfirmationRequest[]>([]);

    React.useEffect(() => {
        return manager.onChange(() => {
            setRequests(Array.from(manager.pending.values()));
        });
    }, [manager]);

    if (requests.length === 0) return null;

    const request = requests[0];
    if (!request) return null;

    return (
        <box
            flexDirection="column"
            gap={1}
            padding={1}
            borderStyle="rounded"
            borderColor={colors.error}
        >
            <text fg={colors.error} attributes={TextAttributes.BOLD}>
                Confirm: {request.toolName}
            </text>
            <text fg={colors.text}>
                {request.reason}
            </text>
            {request.details && (
                <text fg={colors.dimSeparator}>
                    {request.details}
                </text>
            )}
            <text>
                <text attributes={TextAttributes.BOLD} fg={colors.success}>y</text>
                <text fg={colors.dimSeparator}> / </text>
                <text attributes={TextAttributes.BOLD} fg={colors.error}>n</text>
            </text>
        </box>
    );
}
