import { toolInputSchemas } from "@nightcode/shared";
import { globReplace } from "./utils";

export async function searchReplaceTool(input: unknown) {
    const { pattern, replacement, glob: globPattern, flags } = toolInputSchemas.searchReplace.parse(input);
    const normalizedFlags = [...new Set(flags.includes("g") ? flags : flags + "g")].join("");
    const regex = new RegExp(pattern, normalizedFlags);

    return globReplace(globPattern, (content) => {
        const count = (content.match(regex) || []).length;
        return { updated: count > 0 ? content.replace(regex, replacement) : content, count };
    });
}
