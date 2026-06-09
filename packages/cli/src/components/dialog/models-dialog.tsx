import { useCallback } from "react";
import { TextAttributes } from "@opentui/core";

import { useDialog } from "@/providers/dialog";
import type { SupportedChatModelId } from "@nightcode/shared";

import { DialogSearchList } from "@/components/dialog-search-list";
import { getModelName } from "@/lib/model-names";

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
            filterFn={(modelId, query) => {
                const friendly = getModelName(modelId);
                return (
                    modelId.toLowerCase().includes(query.toLowerCase()) ||
                    friendly.toLowerCase().includes(query.toLowerCase())
                );
            }}
            renderItem={(modelId, isSelected) => {
                const friendly = getModelName(modelId);
                const color = isSelected ? "black" : "white";
                return (
                    <text selectable={false} fg={color}>
                        {friendly}
                    </text>
                );
            }}
            getKey={(modelId) => modelId}
            placeholder="Search models"
            emptyText="No matching models"
        />
    )
}
