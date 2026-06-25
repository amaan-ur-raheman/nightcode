import React, {
    useState,
    useCallback,
    useEffect,
    useRef,
    useMemo,
} from 'react';

import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';

import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';

import { EmptyBorder } from '@/components/border';
import { KeyHint } from '@/components/key-hint';

import type {
    QuestionManager,
    QuestionInput,
} from '@/lib/tools/question-manager';

interface QuestionOverlayProps {
    manager: QuestionManager;
}

export function QuestionOverlay({ manager }: QuestionOverlayProps) {
    const { colors } = useTheme();
    const { push, pop, isTopLayer } = useKeyboardLayer();
    const pushedRef = useRef(false);

    // Reactive snapshot of manager.pending
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        return manager.subscribe(() => {
            setRevision((r) => r + 1);
        });
    }, [manager]);

    const current = useMemo(() => manager.current, [manager, revision]);

    // Overlay state
    const [activeTabIndex, setActiveTabIndex] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Use refs for keyboard handler to avoid stale closures
    const customModeRef = useRef(false);
    const customValueRef = useRef('');
    const [customMode, setCustomModeState] = useState(false);
    const [customValue, setCustomValueState] = useState('');

    const setCustomMode = useCallback((v: boolean) => {
        customModeRef.current = v;
        setCustomModeState(v);
    }, []);

    const setCustomValue = useCallback((v: string) => {
        customValueRef.current = v;
        setCustomValueState(v);
    }, []);

    const questions: QuestionInput[] = current ? current[1].questions : [];
    const request = current ? { id: current[0], questions: current[1] } : null;
    const currentQuestion = questions[activeTabIndex] ?? null;
    const choices = currentQuestion?.choices ?? [];
    const allowCustom = currentQuestion?.allowCustom !== false;

    // Push keyboard layer when request is active
    useEffect(() => {
        if (request && !pushedRef.current) {
            push('question', () => {
                if (request) {
                    manager.reject(request.id);
                }
                return true;
            });
            pushedRef.current = true;
        } else if (!request && pushedRef.current) {
            pop('question');
            pushedRef.current = false;
        }
    }, [request, push, pop, manager]);

    // Reset tab state when a new question arrives
    useEffect(() => {
        if (request) {
            setActiveTabIndex(0);
            setSelectedIndex(0);
            setCustomMode(false);
            setCustomValue('');
            answersRef.current.clear();
            setAnswersRevision((r) => r + 1);
        }
    }, [request?.id, setCustomMode, setCustomValue]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pushedRef.current) {
                pop('question');
                pushedRef.current = false;
            }
        };
    }, [pop]);

    // Track answers per question tab
    const answersRef = useRef<Map<number, string>>(new Map());
    const [, setAnswersRevision] = useState(0);

    const setAnswer = useCallback((tab: number, value: string) => {
        answersRef.current.set(tab, value);
        setAnswersRevision((r) => r + 1);
    }, []);

    const handleConfirm = useCallback(() => {
        if (!request) return;

        const allAnswers: string[] = questions.map((q, i) => {
            return answersRef.current.get(i) ?? '';
        });

        manager.resolve(request.id, allAnswers);
    }, [request, manager, questions]);

    const handleTabNext = useCallback(() => {
        if (activeTabIndex < questions.length - 1) {
            setActiveTabIndex((i) => i + 1);
            setSelectedIndex(0);
            setCustomMode(false);
            setCustomValue('');
        } else {
            handleConfirm();
        }
    }, [
        activeTabIndex,
        questions.length,
        handleConfirm,
        setCustomMode,
        setCustomValue,
    ]);

    const handleTabPrev = useCallback(() => {
        if (activeTabIndex > 0) {
            setActiveTabIndex((i) => i - 1);
            setSelectedIndex(0);
            setCustomMode(false);
            setCustomValue('');
        }
    }, [activeTabIndex, setCustomMode, setCustomValue]);

    const handleKeyDown = useCallback(
        (key: {
            name: string;
            shift: boolean;
            ctrl: boolean;
            preventDefault: () => void;
        }) => {
            if (!request || !isTopLayer('question')) return;

            if (key.name === 'escape') {
                key.preventDefault();
                manager.reject(request.id);
                return;
            }

            if (key.name === 'tab' && !key.shift) {
                key.preventDefault();
                // If on last tab (Confirm), auto-confirm
                if (activeTabIndex >= questions.length - 1) {
                    handleConfirm();
                } else {
                    handleTabNext();
                }
                return;
            }

            if (key.name === 'tab' && key.shift) {
                key.preventDefault();
                handleTabPrev();
                return;
            }

            if (key.name === 'up' || (key.name === 'k' && !key.ctrl)) {
                key.preventDefault();
                setSelectedIndex((i) => (i > 0 ? i - 1 : choices.length - 1));
                return;
            }

            if (key.name === 'down' || (key.name === 'j' && !key.ctrl)) {
                key.preventDefault();
                setSelectedIndex((i) => (i < choices.length - 1 ? i + 1 : 0));
                return;
            }

            if (key.name === 'return' || key.name === 'enter') {
                key.preventDefault();
                if (customModeRef.current) {
                    // Submit custom answer
                    const val = customValueRef.current.trim();
                    if (val) {
                        setAnswer(activeTabIndex, val);
                        setCustomMode(false);
                        setCustomValue('');
                    }
                } else if (selectedIndex === choices.length && allowCustom) {
                    // "Type your own answer" selected
                    setCustomMode(true);
                } else if (choices[selectedIndex]) {
                    setAnswer(activeTabIndex, choices[selectedIndex]!);
                }
                return;
            }

            // Text input in custom mode
            if (customModeRef.current && key.name.length === 1 && !key.ctrl) {
                key.preventDefault();
                setCustomValue(customValueRef.current + key.name);
                return;
            }

            // Number shortcuts 1-9 to select choices
            const num = parseInt(key.name, 10);
            if (num >= 1 && num <= choices.length && choices[num - 1]) {
                key.preventDefault();
                setAnswer(activeTabIndex, choices[num - 1]!);
                return;
            }
        },
        [
            request,
            isTopLayer,
            manager,
            activeTabIndex,
            questions.length,
            choices.length,
            selectedIndex,
            allowCustom,
            handleConfirm,
            handleTabNext,
            handleTabPrev,
            setAnswer,
            setCustomMode,
            setCustomValue,
        ],
    );

    useKeyboard(handleKeyDown);

    if (!request) return null;

    return (
        <box
            flexDirection="column"
            width="100%"
            border={['left']}
            borderColor={colors.error}
            customBorderChars={{
                ...EmptyBorder,
                vertical: '┃',
                bottomLeft: '╹',
            }}
        >
            <box
                flexDirection="column"
                paddingX={2}
                paddingY={1}
                backgroundColor={colors.surface}
                width="100%"
                gap={1}
            >
                {/* Tab Header */}
                <box flexDirection="row" gap={2} flexWrap="wrap">
                    {questions.map((q, i) => {
                        const isActive = i === activeTabIndex;
                        const tabLabel =
                            q.question.length > 30
                                ? q.question.slice(0, 30) + '…'
                                : q.question;
                        return (
                            <text
                                key={`tab-${i}`}
                                attributes={
                                    isActive ? TextAttributes.BOLD : undefined
                                }
                                fg={
                                    isActive
                                        ? colors.error
                                        : colors.dimSeparator
                                }
                            >
                                {isActive ? `[${tabLabel}]` : tabLabel}
                            </text>
                        );
                    })}
                    <text
                        attributes={TextAttributes.BOLD}
                        fg={
                            activeTabIndex === questions.length
                                ? colors.success
                                : colors.dimSeparator
                        }
                    >
                        {activeTabIndex === questions.length
                            ? '[Confirm]'
                            : 'Confirm'}
                    </text>
                </box>

                {/* Question Content */}
                <box flexDirection="column" gap={1}>
                    {currentQuestion && (
                        <>
                            <text fg={colors.text}>
                                {currentQuestion.question}
                            </text>

                            {/* Choices */}
                            <box flexDirection="column" gap={0}>
                                {choices.map((choice, i) => {
                                    const isSelected = i === selectedIndex;
                                    const currentAnswer =
                                        answersRef.current.get(activeTabIndex);
                                    const isChosen = currentAnswer === choice;
                                    return (
                                        <text
                                            key={`choice-${i}`}
                                            attributes={
                                                isSelected
                                                    ? TextAttributes.BOLD
                                                    : isChosen
                                                      ? TextAttributes.DIM
                                                      : undefined
                                            }
                                            fg={
                                                isSelected
                                                    ? colors.info
                                                    : isChosen
                                                      ? colors.success
                                                      : colors.text
                                            }
                                        >
                                            {isSelected ? '▸ ' : '  '}
                                            {i + 1}. {choice}
                                            {isChosen ? ' ✓' : ''}
                                        </text>
                                    );
                                })}

                                {/* Custom option */}
                                {allowCustom && (
                                    <text
                                        attributes={
                                            selectedIndex === choices.length
                                                ? TextAttributes.BOLD
                                                : undefined
                                        }
                                        fg={
                                            selectedIndex === choices.length
                                                ? colors.info
                                                : colors.text
                                        }
                                    >
                                        {selectedIndex === choices.length
                                            ? '▸ '
                                            : '  '}
                                        {choices.length + 1}. Type your own
                                        answer
                                    </text>
                                )}
                            </box>

                            {/* Custom input mode */}
                            {customMode && (
                                <box flexDirection="row" gap={1}>
                                    <text fg={colors.dimSeparator}>▸</text>
                                    <text fg={colors.text}>
                                        {customValue || '...'}
                                    </text>
                                </box>
                            )}
                        </>
                    )}
                </box>

                {/* Footer hints */}
                <box
                    flexDirection="row"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    <box flexDirection="row" gap={2}>
                        <KeyHint keyName="⇥" label="question" />
                        <KeyHint keyName="↑↓" label="select" />
                        <KeyHint keyName="enter" label="confirm" />
                    </box>
                    <box flexDirection="row" gap={2}>
                        <KeyHint keyName="esc" label="dismiss" />
                    </box>
                </box>
            </box>
        </box>
    );
}
