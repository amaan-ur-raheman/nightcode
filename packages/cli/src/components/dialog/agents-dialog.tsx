import { useCallback } from "react";

import { useDialog } from "@/providers/dialog";
import { Mode } from "@nightcode/database/enums";

import { DialogSearchList } from "@/components/dialog-search-list";

const AVAILABLE_MODES: Mode[] = [Mode.BUILD, Mode.PLAN];

type AgentsDialogContentProps = {
    currentMode: Mode,
    onSelectMode: (mode: Mode) => void;
};

function getModeLabel(mode: Mode): string {
    return mode === Mode.BUILD ? "Build" : "Plan";
}

export function AgentsDialogContent({ currentMode, onSelectMode }: AgentsDialogContentProps) {
    const dialog = useDialog();

    const handleSelect = useCallback(
        (nextMode: Mode) => {
            onSelectMode(nextMode);
            dialog.close();
        },
        [dialog, onSelectMode]
    );


    return (
        <DialogSearchList
            items={AVAILABLE_MODES}
            onSelect={handleSelect}
            filterFn={(item, query) => getModeLabel(item).toLowerCase().includes(query.toLowerCase())}
            renderItem={(item, isSelected) => (
                <text selectable={false} fg={isSelected ? "black" : "white"}>
                    {item === currentMode ? " • " : "   "}
                    {getModeLabel(item)}
                </text>
            )}
            getKey={(item) => item}
            placeholder="Search agents"
            emptyText="No matching agents"
        />
    )
}
