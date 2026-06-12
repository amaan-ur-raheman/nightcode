import { TextAttributes } from '@opentui/core';
import type { ConversationBranch } from '@nightcode/shared';
import { useTheme } from '@/providers/theme';

type BranchIndicatorProps = {
    branches: ConversationBranch[];
    activeBranchId: string;
    onCreateBranch: () => void;
};

export function BranchIndicator({
    branches,
    activeBranchId,
    onCreateBranch,
}: BranchIndicatorProps) {
    const { colors } = useTheme();
    const activeBranch = branches.find((b) => b.id === activeBranchId);
    const isMain = activeBranchId === 'main';

    return (
        <box flexDirection="row" alignItems="center" gap={1}>
            <text
                attributes={TextAttributes.DIM}
                fg={isMain ? colors.dimSeparator : colors.primary}
            >
                {isMain ? 'main' : (activeBranch?.name ?? 'branch')}
            </text>
            <text
                attributes={TextAttributes.DIM}
                fg={colors.dimSeparator}
                onMouseDown={() => onCreateBranch()}
            >
                [+branch]
            </text>
            {branches.length > 0 && (
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    {`(${branches.length})`}
                </text>
            )}
        </box>
    );
}
