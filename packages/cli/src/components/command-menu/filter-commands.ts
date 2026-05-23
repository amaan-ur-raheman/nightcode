import type { Command } from "@/components/command-menu/types";
import { COMMANDS } from "@/components/command-menu/commands";

export const getFilteredCommands = (query: string): Command[] => {
    if (query.length === 0) return COMMANDS;
    return COMMANDS.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(query.toLowerCase())
    );
}