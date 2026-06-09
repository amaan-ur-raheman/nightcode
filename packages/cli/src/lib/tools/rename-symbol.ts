import { toolInputSchemas } from "@nightcode/shared";
import { globReplace } from "./utils";

export async function renameSymbolTool(input: unknown) {
    const { oldName, newName, glob: globPattern } = toolInputSchemas.renameSymbol.parse(input);
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "g");

    return globReplace(globPattern, (content) => {
        let count = 0;
        const updated = content.replace(regex, () => { count++; return newName; });
        return { updated, count };
    });
}
