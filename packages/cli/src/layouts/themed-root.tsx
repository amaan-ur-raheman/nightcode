import type { ReactNode } from 'react';
import { useTheme } from '@/providers/theme';
import { PtyOverlay } from '@/components/pty-overlay';

type ThemedRootProps = {
    children: ReactNode;
};

export function ThemedRoot({ children }: ThemedRootProps) {
    const { colors } = useTheme();

    return (
        <box
            backgroundColor={colors.background}
            width="100%"
            height="100%"
            flexGrow={1}
        >
            {children}
            <PtyOverlay />
        </box>
    );
}
