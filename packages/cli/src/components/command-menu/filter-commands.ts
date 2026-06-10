import type { ModeType } from "@nightcode/shared";

import type { Command } from "@/components/command-menu/types";
import { COMMANDS } from "@/components/command-menu/commands";

export type FilteredCommand = Command & { _score: number };

function fuzzyMatch(query: string, text: string): number {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Exact substring match gets a high base score
    const exactIdx = textLower.indexOf(queryLower);
    if (exactIdx !== -1) {
        let score = 100;
        // Bonus for prefix match
        if (exactIdx === 0) score += 50;
        // Bonus for word boundary
        if (exactIdx === 0 || textLower[exactIdx - 1] === " " || textLower[exactIdx - 1] === "-") {
            score += 20;
        }
        return score;
    }

    // Fuzzy character-by-character match
    let queryIdx = 0;
    let score = 0;
    let prevMatchIdx = -2;

    for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
        if (textLower[i] === queryLower[queryIdx]) {
            queryIdx++;
            score += 10;

            // Bonus for consecutive matches
            if (i === prevMatchIdx + 1) {
                score += 8;
            }

            // Bonus for word boundary
            if (i === 0 || textLower[i - 1] === " " || textLower[i - 1] === "-" || textLower[i - 1] === "_") {
                score += 5;
            }

            prevMatchIdx = i;
        }
    }

    // All query characters must be found
    return queryIdx === queryLower.length ? score : 0;
}

function sortByRelevance(commands: Command[], query: string): FilteredCommand[] {
    if (!query) {
        return commands.map(cmd => ({ ...cmd, _score: 0 }));
    }

    return commands
        .map(cmd => ({
            ...cmd,
            _score: Math.max(
                fuzzyMatch(query, cmd.name),
                fuzzyMatch(query, cmd.description) * 0.8,
                fuzzyMatch(query, cmd.value) * 0.6
            ),
        }))
        .filter(item => item._score > 0)
        .sort((a, b) => b._score - a._score);
}

export const getFilteredCommands = (
    query: string,
    mode: ModeType = "BUILD",
    sessionId?: string
): FilteredCommand[] => {
    const commands = COMMANDS.filter(cmd => {
        if (mode !== "BUILD" && cmd.requiresBuildMode) return false;
        // If not in a session, hide session-only commands that don't make sense on the home page
        if (!sessionId && (cmd.name === "files" || cmd.name === "clear" || cmd.name === "undo" || cmd.name === "branch" || cmd.name === "export")) {
            return false;
        }
        return true;
    });
    if (query.length === 0) {
        return commands.map(cmd => ({ ...cmd, _score: 0 }));
    }
    return sortByRelevance(commands, query);
};

