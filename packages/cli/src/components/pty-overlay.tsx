import React, { useEffect, useRef } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { TextAttributes, RGBA } from '@opentui/core';
import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { usePtySession } from '@/lib/pty-session';
import { debug } from '@/lib/debug';

const stripAnsi = (str: string) => {
    return str.replace(
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        '',
    );
};

const sanitizeTerminalOutput = (output: string) => {
    const clean = stripAnsi(output);
    const lines = clean.split('\n');
    return lines
        .map((line) => {
            const parts = line.split('\r');
            return parts[parts.length - 1] ?? '';
        })
        .join('\n');
};

export function PtyOverlay() {
    const { active, command, output, isAttached, detach, writeInput, interrupt } =
        usePtySession();
    const { isTopLayer, push, pop } = useKeyboardLayer();
    const dimensions = useTerminalDimensions();
    const { colors } = useTheme();

    // Push the keyboard layer when attached, so we intercept all key events.
    useEffect(() => {
        if (isAttached) {
            push('pty', () => {
                // Handle Ctrl+C propagation for app close prevention
                interrupt();
                return true;
            });
        } else {
            pop('pty');
        }
        return () => {
            pop('pty');
        };
    }, [isAttached, push, pop, interrupt]);

    useKeyboard((key) => {
        if (!isAttached || !isTopLayer('pty')) return;

        debug.log(
            'pty',
            `Key pressed: name=${key.name}, ctrl=${key.ctrl}, raw=${key.raw}, sequence=${key.sequence}`,
        );

        // Ctrl+D to detach
        if (key.ctrl && key.name === 'd') {
            key.preventDefault();
            detach();
            return;
        }

        // Ctrl+P to detach as well (toggle off)
        if (key.ctrl && key.name === 'p') {
            key.preventDefault();
            detach();
            return;
        }

        // Ctrl+C to interrupt
        if (key.ctrl && key.name === 'c') {
            key.preventDefault();
            interrupt();
            return;
        }

        // Prevent default input behavior in rest of the application
        key.preventDefault();

        let toSend = '';
        if (key.ctrl) {
            const name = key.name.toLowerCase();
            if (name.length === 1) {
                const code = name.charCodeAt(0) - 96;
                if (code >= 1 && code <= 26) {
                    toSend = String.fromCharCode(code);
                }
            }
        } else if (key.name === 'return' || key.name === 'enter') {
            toSend = '\n';
        } else if (key.name === 'backspace') {
            toSend = '\x7f';
        } else if (key.name === 'tab') {
            toSend = '\t';
        } else if (key.name === 'escape') {
            toSend = '\x1b';
        } else if (key.name === 'up') {
            toSend = '\x1b[A';
        } else if (key.name === 'down') {
            toSend = '\x1b[B';
        } else if (key.name === 'right') {
            toSend = '\x1b[C';
        } else if (key.name === 'left') {
            toSend = '\x1b[D';
        } else if (key.sequence) {
            toSend = key.sequence;
        } else if (key.raw) {
            toSend = key.raw;
        }

        if (toSend) {
            writeInput(toSend);
        }
    });

    if (!isAttached) {
        return null;
    }

    const sanitizedOutput = sanitizeTerminalOutput(output);
    const overlayWidth = Math.min(90, dimensions.width - 4);
    const overlayHeight = Math.min(22, dimensions.height - 4);

    return (
        <box
            position="absolute"
            left={0}
            top={0}
            width={dimensions.width}
            height={dimensions.height}
            justifyContent="center"
            alignItems="center"
            backgroundColor={RGBA.fromInts(0, 0, 0, 120)}
            zIndex={150}
        >
            <box
                width={overlayWidth}
                height={overlayHeight}
                backgroundColor={colors.dialogSurface}
                paddingX={2}
                paddingY={1}
                flexDirection="column"
                gap={1}
                border={['top', 'bottom', 'left', 'right']}
                borderColor={colors.primary}
            >
                <box
                    flexShrink={0}
                    flexDirection="row"
                    justifyContent="space-between"
                    paddingBottom={1}
                    border={['bottom']}
                    borderColor={colors.dimSeparator}
                >
                    <text attributes={TextAttributes.BOLD} fg={colors.primary}>
                        Interactive Terminal Session
                    </text>
                    <text attributes={TextAttributes.DIM} fg={colors.text}>
                        {command.slice(0, 40) +
                            (command.length > 40 ? '...' : '')}
                    </text>
                </box>

                <scrollbox
                    flexGrow={1}
                    width="100%"
                    stickyScroll
                    stickyStart="bottom"
                    paddingY={1}
                >
                    <text fg={colors.text}>{sanitizedOutput}</text>
                </scrollbox>

                <box
                    flexShrink={0}
                    flexDirection="row"
                    justifyContent="space-between"
                    paddingTop={1}
                    border={['top']}
                    borderColor={colors.dimSeparator}
                >
                    <box flexDirection="row" gap={1}>
                        <text
                            fg={colors.success}
                            attributes={TextAttributes.BOLD}
                        >
                            Ctrl+D
                        </text>
                        <text fg={colors.text} attributes={TextAttributes.DIM}>
                            detach
                        </text>
                    </box>
                    <box flexDirection="row" gap={1}>
                        <text
                            fg={colors.error}
                            attributes={TextAttributes.BOLD}
                        >
                            Ctrl+C
                        </text>
                        <text fg={colors.text} attributes={TextAttributes.DIM}>
                            interrupt
                        </text>
                    </box>
                </box>
            </box>
        </box>
    );
}
