import type { ModeType, SupportedChatModelId } from "@nightcode/shared";

import type { ToastContextValue } from "@/providers/toast";
import type { DialogContextValue } from "@/providers/dialog";

export type CommandContext = {
    exit: () => void;
    toast: ToastContextValue
    dialog: DialogContextValue;
    navigate: (path: string) => void;
    mode: ModeType,
    setMode: (mode: ModeType) => void;
    setModel: (model: SupportedChatModelId) => void;
    setInputValue: (value: string) => void;
}

export type Command = {
    name: string;
    description: string;
    value: string;
    action?: (ctx: CommandContext) => void | Promise<void>;
}
