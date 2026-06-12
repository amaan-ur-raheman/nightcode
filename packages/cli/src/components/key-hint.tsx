import { TextAttributes } from '@opentui/core';

type KeyHintProps = {
    keyName: string;
    label: string;
};

export function KeyHint({ keyName, label }: KeyHintProps) {
    return (
        <>
            <text>{keyName}</text>
            <text attributes={TextAttributes.DIM}>{label}</text>
        </>
    );
}
