import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router';

import { useToast } from '@/providers/toast';
import { useDialog } from '@/providers/dialog';
import { TextAttributes } from '@opentui/core';

import { DialogSearchList } from '@/components/dialog-search-list';
import {
    listExportFiles,
    importSession,
    type ExportFile,
} from '@/lib/session-utils';

export function ImportDialogContent() {
    const [files, setFiles] = useState<ExportFile[]>([]);
    const [loading, setLoading] = useState(true);
    const { close } = useDialog();
    const { show } = useToast();
    const navigate = useNavigate();

    useEffect(() => {
        try {
            const exportFiles = listExportFiles();
            setFiles(exportFiles);
        } catch (error) {
            show({
                variant: 'error',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Failed to list exports',
            });
        } finally {
            setLoading(false);
        }
    }, [show]);

    const handleSelect = useCallback(
        async (file: ExportFile) => {
            try {
                show({ message: `Importing ${file.title}...` });
                const imported = await importSession(file.path);
                show({
                    message: `Imported "${imported.title}"`,
                    variant: 'success',
                });
                navigate(`/sessions/${imported.id}`);
                close();
            } catch (error) {
                show({
                    variant: 'error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Import failed',
                });
            }
        },
        [close, show, navigate],
    );

    if (loading) {
        return (
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Loading exports...</text>
            </box>
        );
    }

    return (
        <DialogSearchList
            items={files}
            onSelect={handleSelect}
            filterFn={(f, query) =>
                f.title.toLowerCase().includes(query.toLowerCase()) ||
                f.name.toLowerCase().includes(query.toLowerCase())
            }
            renderItem={(file, isSelected) => (
                <>
                    <text
                        selectable={false}
                        fg={isSelected ? 'black' : 'white'}
                    >
                        {file.title}
                    </text>
                    <box flexGrow={1} />
                    <text
                        selectable={false}
                        fg={isSelected ? 'black' : undefined}
                        attributes={TextAttributes.DIM}
                    >
                        {file.exportedAt
                            ? new Intl.DateTimeFormat('en', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true,
                              }).format(new Date(file.exportedAt))
                            : ''}
                    </text>
                </>
            )}
            getKey={(f) => f.path}
            placeholder="Search exports"
            emptyText="No export files found. Use /export first."
        />
    );
}
