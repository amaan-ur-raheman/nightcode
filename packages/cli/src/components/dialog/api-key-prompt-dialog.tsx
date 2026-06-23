import { useState, useRef, useCallback } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { useTheme } from '@/providers/theme';
import type { InputRenderable } from '@opentui/core';

import { setApiKey, setCloudflareAccountId } from '@/lib/api-keys';

type ApiKeyPromptDialogProps = {
    provider: string;
    onSuccess: () => void;
    onCancel: () => void;
};

type CloudflareStep = 'account-id' | 'api-key';

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

    // Cloudflare two-step flow
    const isCloudflare = provider === 'cloudflare';
    const [cloudflareStep, setCloudflareStep] =
        useState<CloudflareStep>('account-id');
    const [accountId, setAccountId] = useState('');

    const handleSubmitApiKey = useCallback(async () => {
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

    const handleSubmitAccountId = useCallback(async () => {
        if (!accountId.trim()) {
            setError('Account ID cannot be empty');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const success = await setCloudflareAccountId(accountId.trim());
            if (success) {
                // Move to API key step
                setCloudflareStep('api-key');
                setError(null);
            } else {
                setError('Failed to store Account ID. Please try again.');
            }
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [accountId]);

    const handleSubmit = useCallback(() => {
        if (isCloudflare && cloudflareStep === 'account-id') {
            handleSubmitAccountId();
        } else {
            handleSubmitApiKey();
        }
    }, [
        isCloudflare,
        cloudflareStep,
        handleSubmitAccountId,
        handleSubmitApiKey,
    ]);

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

    if (isCloudflare && cloudflareStep === 'account-id') {
        return (
            <box flexDirection="column" gap={1}>
                <text fg={colors.text}>
                    Enter your{' '}
                    <em attributes={TextAttributes.BOLD} fg={colors.primary}>
                        Cloudflare Account ID
                    </em>
                    :
                </text>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    Find it in your Cloudflare dashboard URL:
                    dash.cloudflare.com/&lt;account-id&gt;
                </text>
                <input
                    ref={inputRef}
                    placeholder="Account ID"
                    focused
                    onContentChange={() =>
                        setAccountId(inputRef.current?.value ?? '')
                    }
                />
                {error && <text fg={colors.error}>{error}</text>}
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                    {loading
                        ? 'Storing...'
                        : 'Press Enter to continue, Esc to cancel'}
                </text>
            </box>
        );
    }

    const promptLabel = isCloudflare ? 'API Key' : 'API key';

    return (
        <box flexDirection="column" gap={1}>
            <text fg={colors.text}>
                Enter your{' '}
                <em attributes={TextAttributes.BOLD} fg={colors.primary}>
                    {isCloudflare ? 'Cloudflare Workers AI ' : ''}
                    {promptLabel}
                </em>
                :
            </text>
            <input
                ref={inputRef}
                placeholder={promptLabel}
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
