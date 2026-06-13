import { useCallback, useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';

import { useDialog } from '@/providers/dialog';
import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { useKeyboard } from '@opentui/react';

import { getApiKeyStatus, deleteApiKey } from '@/lib/api-keys';
import { getProviderDisplayName } from '@/lib/model-names';
import { PROVIDER_KEYCHAIN_NAMES } from '@nightcode/shared';
import { ApiKeyPromptDialog } from './api-key-prompt-dialog';

type ProviderItem = {
    provider: string;
    displayName: string;
    hasKey: boolean;
};

const MAX_VISIBLE_ITEMS = 12;

export function ApiKeyDialogContent() {
    const dialog = useDialog();
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const [providers, setProviders] = useState<ProviderItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [promptingProvider, setPromptingProvider] = useState<string | null>(
        null,
    );
    const [confirmingDelete, setConfirmingDelete] = useState<string | null>(
        null,
    );

    const loadProviders = useCallback(async () => {
        const status = await getApiKeyStatus();
        const items: ProviderItem[] = Object.keys(PROVIDER_KEYCHAIN_NAMES)
            .filter((p) => p !== 'local')
            .sort()
            .map((provider) => ({
                provider,
                displayName: getProviderDisplayName(provider),
                hasKey: status.providers?.[provider] === true,
            }));
        setProviders(items);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadProviders();
    }, [loadProviders]);

    const handleSelect = useCallback((provider: string) => {
        setPromptingProvider(provider);
    }, []);

    const handleDelete = useCallback(
        async (provider: string) => {
            await deleteApiKey(provider);
            setConfirmingDelete(null);
            await loadProviders();
        },
        [loadProviders],
    );

    const handleApiKeySuccess = useCallback(async () => {
        setPromptingProvider(null);
        await loadProviders();
    }, [loadProviders]);

    const handleApiKeyCancel = useCallback(() => {
        setPromptingProvider(null);
    }, []);

    useKeyboard((key) => {
        if (!isTopLayer('dialog')) return;

        if (confirmingDelete) {
            if (key.name === 'y' || key.name === 'Y') {
                handleDelete(confirmingDelete);
            } else if (
                key.name === 'n' ||
                key.name === 'N' ||
                key.name === 'escape'
            ) {
                setConfirmingDelete(null);
            }
            return;
        }

        if (providers.length === 0) return;

        if (key.name === 'return' || key.name === 'enter') {
            const item = providers[selectedIndex];
            if (item) {
                handleSelect(item.provider);
            }
        } else if (key.name === 'up') {
            setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (key.name === 'down') {
            setSelectedIndex((i) => Math.min(i + 1, providers.length - 1));
        } else if (key.name === 'd' || key.name === 'D') {
            const item = providers[selectedIndex];
            if (item?.hasKey) {
                setConfirmingDelete(item.provider);
            }
        } else if (key.name === 'escape') {
            dialog.close();
        }
    });

    if (loading) {
        return <text attributes={TextAttributes.DIM}>Loading...</text>;
    }

    if (promptingProvider) {
        return (
            <ApiKeyPromptDialog
                provider={promptingProvider}
                onSuccess={handleApiKeySuccess}
                onCancel={handleApiKeyCancel}
            />
        );
    }

    if (confirmingDelete) {
        const displayName = getProviderDisplayName(confirmingDelete);
        return (
            <box flexDirection="column" gap={1}>
                <text fg={colors.text}>
                    Delete API key for{' '}
                    <em attributes={TextAttributes.BOLD} fg={colors.primary}>
                        {displayName}
                    </em>
                    ?
                </text>
                <text fg={colors.dimSeparator}>
                    Press Y to confirm, N/Esc to cancel
                </text>
            </box>
        );
    }

    const visibleHeight = Math.min(providers.length, MAX_VISIBLE_ITEMS);

    return (
        <box flexDirection="column" gap={1}>
            <scrollbox ref={null} height={visibleHeight}>
                {providers.map((item, i) => {
                    const isSelected = i === selectedIndex;
                    const color = isSelected ? 'black' : 'white';
                    const indicatorColor = isSelected
                        ? 'black'
                        : colors.success;
                    return (
                        <box
                            key={item.provider}
                            flexDirection="row"
                            height={1}
                            overflow="hidden"
                            backgroundColor={
                                isSelected ? colors.selection : undefined
                            }
                            onMouseMove={() => setSelectedIndex(i)}
                            onMouseDown={() => handleSelect(item.provider)}
                        >
                            <text selectable={false} fg={indicatorColor}>
                                {item.hasKey ? '✓ ' : '  '}
                            </text>
                            <text selectable={false} fg={color}>
                                {item.displayName}
                            </text>
                            {item.hasKey && isSelected && (
                                <text selectable={false} fg={colors.error}>
                                    {'  [D] delete'}
                                </text>
                            )}
                            {item.hasKey && !isSelected && (
                                <text
                                    selectable={false}
                                    fg={colors.dimSeparator}
                                >
                                    {'  configured'}
                                </text>
                            )}
                            {!item.hasKey && (
                                <text
                                    selectable={false}
                                    fg={colors.dimSeparator}
                                >
                                    {'  no key'}
                                </text>
                            )}
                        </box>
                    );
                })}
            </scrollbox>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                Enter to set/change key, D to delete, Esc to close
            </text>
        </box>
    );
}
