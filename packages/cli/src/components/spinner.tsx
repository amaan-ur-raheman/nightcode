import "opentui-spinner/react";

import { useTheme } from "@/providers/theme";
import { Mode, type ModeType } from "@nightcode/shared";

type SpinnerProps = {
    mode?: ModeType;
};

export function Spinner({ mode = Mode.BUILD }: SpinnerProps) {
    const { colors } = useTheme();
    const activeColor = mode === Mode.PLAN ? colors.planMode : colors.primary;

    return (
        <spinner
            name="aesthetic"
            color={activeColor}
        />
    );
}
