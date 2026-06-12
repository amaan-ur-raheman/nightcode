import { useState, useEffect, useRef } from 'react';
import prettyMs from 'pretty-ms';

import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

/**
 * Displays a live elapsed-time counter while a tool call is in progress.
 * Starts on mount, stops on unmount.
 */
export function ToolTimer() {
    const { colors } = useTheme();
    const startTimeRef = useRef(Date.now());
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const id = setInterval(() => {
            setElapsed(Date.now() - startTimeRef.current);
        }, 100);

        return () => clearInterval(id);
    }, []);

    return <em fg={colors.dimSeparator}> {prettyMs(elapsed)}</em>;
}
