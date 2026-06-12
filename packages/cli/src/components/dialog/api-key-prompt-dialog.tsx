import { useState, useRef, useCallback } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { useTheme } from '@/providers/theme';
import type { InputRenderable } from '@opentui/core';

import { setApiKey } from '@/lib/api-keys';

type ApiKeyPromptDialogProps = {
    provider: string;
    onSuccess: () => void;
    onCancel: () => void;
};

export function ApiKeyPromptDialog({
    provider,
    onSuccess,
    onCancel,
}: ApiKeyPromptDialogProps) {
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const [apiKey, setApiKeyState] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<InputRenderable>(null);

    const handleSubmit = useCallback(async () => {
        if (!apiKey.trim()) {
            setError('API key cannot be empty');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await setApiKey(provider, apiKey.trim());
            if (result?.success) {
                onSuccess();
            } else {
                setError('Failed to store API key. Please try again.');
            }
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [provider, apiKey, onSuccess]);

    useKeyboard((key) => {
        if (!isTopLayer('dialog')) return;

        if (key.name === 'return' || key.name === 'enter') {
            key.preventDefault();
            handleSubmit();
        } else if (key.name === 'escape') {
            key.preventDefault();
            onCancel();
        }
    });

    return (
        <box flexDirection="column" gap={1}>
            <text fg={colors.text}>
                Enter your API key for{' '}
                <em attributes={TextAttributes.BOLD} fg={colors.primary}>
                    {provider}
                </em>
                :
            </text>
            <input
                ref={inputRef}
                placeholder="API key"
                focused
                onContentChange={() =>
                    setApiKeyState(inputRef.current?.value ?? '')
                }
            />
            {error && <text fg={colors.error}>{error}</text>}
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                {loading ? 'Storing...' : 'Press Enter to save, Esc to cancel'}
            </text>
        </box>
    );
}
