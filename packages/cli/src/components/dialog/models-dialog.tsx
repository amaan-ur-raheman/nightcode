import { useCallback } from "react";

import { useDialog } from "@/providers/dialog";
import type { SupportedChatModelId } from "@nightcode/shared";

import { DialogSearchList } from "@/components/dialog-search-list";


type ModelsDialogContentProps = {
    models: SupportedChatModelId[],
    onSelectModel: (model: SupportedChatModelId) => void;
};

export function ModelsDialogContent({ models, onSelectModel }: ModelsDialogContentProps) {
    const dialog = useDialog();

    const handleSelect = useCallback(
        (modelId: SupportedChatModelId) => {
            onSelectModel(modelId);
            dialog.close();
        },
        [dialog, onSelectModel]
    );


    return (
        <DialogSearchList
            items={models}
            onSelect={handleSelect}
            filterFn={(modelId, query) => modelId.toLowerCase().includes(query.toLowerCase())}
            renderItem={(modelId, isSelected) => (
                <text selectable={false} fg={isSelected ? "black" : "white"}>
                    {modelId}
                </text>
            )}
            getKey={(modelId) => modelId}
            placeholder="Search models"
            emptyText="No matching models"
        />
    )
}
