import { Mode, type ModeType } from "@nightcode/shared";
import type { ThemeColors } from "@/theme";

export function getModeColor(mode: ModeType | undefined, colors: ThemeColors): string {
    return mode === Mode.PLAN ? colors.planMode : colors.primary;
}
