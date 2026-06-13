import type { ReactNode } from 'react';
import {
    createContext,
    useContext,
    useState,
    useCallback,
    useMemo,
} from 'react';

import { TextAttributes, RGBA } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';

import { useTheme } from '@/providers/theme';
import type { DialogConfig } from '@/providers/dialog/types';
import { useKeyboardLayer } from '@/providers/keyboard-layer';

export type DialogContextValue = {
    open: (config: DialogConfig) => void;
    close: () => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
    const context = useContext(DialogContext);
    if (!context) {
        throw new Error('useDialog must be used within a DialogProvider');
    }

    return context;
}

type DialogProviderProps = {
    children: ReactNode;
};

export const DialogProvider = ({ children }: DialogProviderProps) => {
    const [currentDialog, setCurrentDialog] = useState<DialogConfig | null>(
        null,
    );
    const { push, pop } = useKeyboardLayer();

    const close = useCallback(() => {
        setCurrentDialog(null);
        pop('dialog');
    }, [pop]);

    const open = useCallback(
        (config: DialogConfig) => {
            setCurrentDialog(config);
            push('dialog', () => {
                close();
                return true;
            });
        },
        [push, close],
    );

    const value: DialogContextValue = useMemo(
        () => ({
            open,
            close,
        }),
        [open, close],
    );

    return (
        <DialogContext.Provider value={value}>
            {children}
            <Dialog currentDialog={currentDialog} close={close} />
        </DialogContext.Provider>
    );
};

type DialogProps = {
    currentDialog: DialogConfig | null;
    close: () => void;
};

function Dialog({ currentDialog, close }: DialogProps) {
    const { isTopLayer } = useKeyboardLayer();
    const dimensions = useTerminalDimensions();
    const { colors } = useTheme();

    useKeyboard((key) => {
        if (!currentDialog || !isTopLayer('dialog')) return;

        if (key.name === 'escape') {
            close();
        }
    });

    if (!currentDialog) {
        return null;
    }

    const { title, children } = currentDialog;

    return (
        <box
            position="absolute"
            left={0}
            right={0}
            width={dimensions.width}
            height={dimensions.height}
            justifyContent="center"
            alignItems="center"
            backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
            zIndex={100}
            onMouseDown={() => close()}
        >
            <box
                width={
                    currentDialog.width
                        ? Math.min(currentDialog.width, dimensions.width - 4)
                        : Math.min(60, dimensions.width - 4)
                }
                height="auto"
                backgroundColor={colors.dialogSurface}
                paddingX={4}
                paddingY={1}
                flexDirection="column"
                gap={1}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <box
                    paddingBottom={1}
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <text attributes={TextAttributes.BOLD}>{title}</text>
                    <text
                        attributes={TextAttributes.DIM}
                        onMouseDown={() => close()}
                    >
                        esc
                    </text>
                </box>
                <box flexGrow={1}>{children}</box>
            </box>
        </box>
    );
}
