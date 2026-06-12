import React from 'react';
import { ConfirmDialog } from './confirm-dialog';

interface DiffDialogProps {
    filePath: string;
    diff: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function DiffDialog({
    filePath,
    diff,
    onConfirm,
    onCancel,
}: DiffDialogProps) {
    return (
        <ConfirmDialog
            message={`Apply changes to ${filePath}?\n\n${diff}`}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}
