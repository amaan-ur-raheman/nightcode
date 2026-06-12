import 'opentui-spinner/react';

import { useTheme } from '@/providers/theme';
import { type ModeType } from '@nightcode/shared';
import { getModeColor } from '@/lib/mode-utils';

type SpinnerProps = {
    mode?: ModeType;
};

export function Spinner({ mode }: SpinnerProps) {
    const { colors } = useTheme();

    return <spinner name="aesthetic" color={getModeColor(mode, colors)} />;
}
