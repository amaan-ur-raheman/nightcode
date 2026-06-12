import React from 'react';

import { TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

type QuestionResultProps = {
    questions: string[];
    answers: string[];
};

export function QuestionResult({ questions, answers }: QuestionResultProps) {
    const { colors } = useTheme();

    return (
        <box
            flexDirection="column"
            gap={1}
            paddingX={1}
            paddingY={1}
            backgroundColor={colors.dialogSurface}
        >
            <text attributes={TextAttributes.BOLD} fg={colors.error}>
                # Questions
            </text>
            {questions.map((q, i) => (
                <box key={`q-${i}`} flexDirection="column" gap={0}>
                    <text fg={colors.dimSeparator}>{q}</text>
                    <text attributes={TextAttributes.BOLD} fg={colors.text}>
                        {answers[i] || ''}
                    </text>
                </box>
            ))}
        </box>
    );
}
