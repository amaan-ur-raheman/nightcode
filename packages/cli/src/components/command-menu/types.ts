import type { ModeType, SupportedChatModelId } from "@nightcode/shared";

import type { ToastContextValue } from "@/providers/toast";
import type { DialogContextValue } from "@/providers/dialog";

export type CommandCategory = "session" | "mcp" | "settings" | "account" | "debug";

export type CommandContext = {
    exit: () => void;
    toast: ToastContextValue
    dialog: DialogContextValue;
    navigate: (path: string) => void;
    mode: ModeType,
    setMode: (mode: ModeType) => void;
    setModel: (model: SupportedChatModelId) => void;
    setInputValue: (value: string) => void;
    clearMessages: () => void;
    createBranch: () => void;
    switchBranch: (branchId: string) => void;
    toggleFileTree: () => void;
    sessionId?: string;
    recentCommandIds?: string[];
}

export type Command = {
    name: string;
    description: string;
    value: string;
    shortcut?: string;
    category?: CommandCategory;
    requiresBuildMode?: boolean;
    action?: (ctx: CommandContext) => void | Promise<void>;
}

