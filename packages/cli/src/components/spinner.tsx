import "opentui-spinner/react";

import { Mode } from "@nightcode/database/enums";
import { useTheme } from "@/providers/theme";

type SpinnerProps = {
    mode?: Mode;
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
