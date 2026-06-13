import { useCallback, useEffect, useRef, useState } from 'react';
import { TextAttributes } from '@opentui/core';

import { useDialog } from '@/providers/dialog';
import type { DynamicModel } from '@nightcode/shared';

import { useTheme } from '@/providers/theme';
import { useKeyboardLayer } from '@/providers/keyboard-layer';
import { useKeyboard } from '@opentui/react';
import type { ScrollBoxRenderable, InputRenderable } from '@opentui/core';

import { fetchDynamicModels } from '@/lib/models-api';
import {
    deriveModelDisplayName,
    getProviderDisplayName,
} from '@/lib/model-names';
import { getApiKeyStatus } from '@/lib/api-keys';
import { PROVIDER_KEYCHAIN_NAMES } from '@nightcode/shared';
import { ApiKeyPromptDialog } from './api-key-prompt-dialog';

type ModelsDialogContentProps = {
    onSelectModel: (modelId: string) => void;
};

const MAX_VISIBLE_ITEMS = 12;

type View =
    | { kind: 'providers'; providers: ProviderGroup[]; query: string }
    | {
          kind: 'models';
          provider: string;
          models: DynamicModel[];
          query: string;
      };

type ProviderGroup = {
    provider: string;
    displayName: string;
    models: DynamicModel[];
};

export function ModelsDialogContent({
    onSelectModel,
}: ModelsDialogContentProps) {
    const dialog = useDialog();
    const { colors } = useTheme();
    const { isTopLayer } = useKeyboardLayer();
    const [allModels, setAllModels] = useState<DynamicModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<View>({
        kind: 'providers',
        providers: [],
        query: '',
    });
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<InputRenderable>(null);
    const scrollRef = useRef<ScrollBoxRenderable>(null);
    const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>(
        {},
    );
    const [promptingProvider, setPromptingProvider] = useState<string | null>(
        null,
    );

    // Build provider groups from all models, including providers without keys
    const buildProviders = useCallback(
        (models: DynamicModel[]): ProviderGroup[] => {
            const grouped = new Map<string, DynamicModel[]>();
            for (const m of models) {
                if (!grouped.has(m.provider)) grouped.set(m.provider, []);
                grouped.get(m.provider)!.push(m);
            }
            // Ensure all known providers appear even if they have no models yet
            for (const provider of Object.keys(PROVIDER_KEYCHAIN_NAMES)) {
                if (!grouped.has(provider)) {
                    grouped.set(provider, []);
                }
            }
            return Array.from(grouped.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([provider, models]) => ({
                    provider,
                    displayName: getProviderDisplayName(provider),
                    models,
                }));
        },
        [],
    );

    // Build filtered providers list
    const filterProviders = useCallback(
        (providers: ProviderGroup[], query: string): ProviderGroup[] => {
            if (!query) return providers;
            const q = query.toLowerCase();
            return providers.filter(
                (p) =>
                    p.displayName.toLowerCase().includes(q) ||
                    p.provider.toLowerCase().includes(q) ||
                    p.models.some((m) => {
                        const name = deriveModelDisplayName(m.id, m.provider);
                        return name.toLowerCase().includes(q);
                    }),
            );
        },
        [],
    );

    // Build filtered model list
    const filterModels = useCallback(
        (models: DynamicModel[], query: string): DynamicModel[] => {
            if (!query) return models;
            const q = query.toLowerCase();
            return models.filter((m) => {
                const name =
                    m.displayName || deriveModelDisplayName(m.id, m.provider);
                return (
                    m.id.toLowerCase().includes(q) ||
                    name.toLowerCase().includes(q)
                );
            });
        },
        [],
    );

    // Load models on mount
    useEffect(() => {
        Promise.all([fetchDynamicModels(), getApiKeyStatus()]).then(
            ([modelsResult, apiStatus]) => {
                setAllModels(modelsResult.models);
                const providers = buildProviders(modelsResult.models);
                setView({ kind: 'providers', providers, query: '' });
                if (apiStatus.providers) {
                    setApiKeyStatus(apiStatus.providers);
                }
                setLoading(false);
            },
        );
    }, [buildProviders]);

    // Get currently visible items
    const getVisibleItems = useCallback((): Array<{
        key: string;
        label: string;
        sublabel?: string;
        indicator?: string;
    }> => {
        if (view.kind === 'providers') {
            return filterProviders(view.providers, view.query).map((p) => {
                const hasKey = apiKeyStatus[p.provider] === true;
                const indicator = hasKey ? '✓' : undefined;
                const sublabel = !hasKey
                    ? 'API key needed'
                    : p.models.length > 0
                      ? `${p.models.length} models`
                      : 'no models';
                return {
                    key: p.provider,
                    label: p.displayName,
                    sublabel,
                    indicator,
                };
            });
        }
        return filterModels(view.models, view.query).map((m) => {
            const name = m.displayName || deriveModelDisplayName(m.id, m.provider);
            return {
                key: m.id,
                label: m.provider === 'local' ? `[Local] ${name}` : name,
            };
        });
    }, [view, filterProviders, filterModels, apiKeyStatus]);

    const visibleItems = getVisibleItems();

    const handleContentChange = useCallback(() => {
        const text = inputRef.current?.value ?? '';
        setSelectedIndex(0);
        scrollRef.current?.scrollTo(0);
        setView((prev) => {
            if (prev.kind === 'providers') {
                return { ...prev, query: text };
            }
            return { ...prev, query: text };
        });
    }, []);

    const handleSelect = useCallback(
        (key: string) => {
            if (view.kind === 'providers') {
                const provider = view.providers.find((p) => p.provider === key);
                if (provider) {
                    // Prompt for API key if provider has no key or no models
                    // (some listing endpoints return models without auth, but API calls fail)
                    if (
                        !apiKeyStatus[provider.provider] ||
                        provider.models.length === 0
                    ) {
                        setPromptingProvider(provider.provider);
                        return;
                    }
                    setView({
                        kind: 'models',
                        provider: provider.provider,
                        models: provider.models,
                        query: '',
                    });
                    setSelectedIndex(0);
                    scrollRef.current?.scrollTo(0);
                    // Clear search input
                    if (inputRef.current) {
                        inputRef.current.value = '';
                    }
                }
            } else {
                onSelectModel(key);
                dialog.close();
            }
        },
        [view, dialog, onSelectModel, apiKeyStatus],
    );

    const handleBack = useCallback(() => {
        const providers = buildProviders(allModels);
        setView({ kind: 'providers', providers, query: '' });
        setSelectedIndex(0);
        scrollRef.current?.scrollTo(0);
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    }, [allModels, buildProviders]);

    const handleApiKeySuccess = useCallback(async () => {
        setPromptingProvider(null);
        // Refresh models after API key is stored
        const result = await fetchDynamicModels(true);
        setAllModels(result.models);
        const providers = buildProviders(result.models);
        setView({ kind: 'providers', providers, query: '' });
        // Update API key status
        const status = await getApiKeyStatus();
        if (status.providers) {
            setApiKeyStatus(status.providers);
        }
    }, [buildProviders]);

    const handleApiKeyCancel = useCallback(() => {
        setPromptingProvider(null);
    }, []);

    useKeyboard((key) => {
        if (!isTopLayer('dialog')) return;
        if (visibleItems.length === 0) return;

        if (key.name === 'return' || key.name === 'enter') {
            const item = visibleItems[selectedIndex];
            if (item) {
                handleSelect(item.key);
            }
        } else if (key.name === 'up') {
            setSelectedIndex((i) => {
                const newIndex = Math.max(0, i - 1);
                scrollRef.current?.scrollTo(newIndex);
                return newIndex;
            });
        } else if (key.name === 'down') {
            setSelectedIndex((i) => {
                const newIndex = Math.min(i + 1, visibleItems.length - 1);
                const sb = scrollRef.current;
                if (sb) {
                    const viewportHeight = sb.viewport.height;
                    const visibleEnd = sb.scrollTop + viewportHeight - 1;
                    if (newIndex > visibleEnd) {
                        sb.scrollTo(newIndex - viewportHeight + 1);
                    }
                }
                return newIndex;
            });
        } else if (key.name === 'escape' && view.kind === 'models') {
            handleBack();
        }
    });

    if (loading) {
        return <text attributes={TextAttributes.DIM}>Loading models...</text>;
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

    const visibleHeight = Math.min(visibleItems.length, MAX_VISIBLE_ITEMS);
    const title =
        view.kind === 'providers'
            ? 'Select Provider'
            : getProviderDisplayName(view.provider);

    return (
        <box flexDirection="column" gap={1}>
            {view.kind === 'models' && (
                <box flexDirection="row" height={1} overflow="hidden">
                    <text
                        selectable={false}
                        fg={colors.primary}
                        onMouseDown={handleBack}
                    >
                        {'← Back'}
                    </text>
                    <text selectable={false} fg={colors.dimSeparator}>
                        {'  '}
                    </text>
                    <text selectable={false} fg={colors.text}>
                        {title}
                    </text>
                </box>
            )}
            <input
                ref={inputRef}
                placeholder={
                    view.kind === 'providers'
                        ? 'Search providers'
                        : 'Search models'
                }
                focused
                onContentChange={handleContentChange}
            />
            {visibleItems.length === 0 ? (
                <text attributes={TextAttributes.DIM}>No matching items</text>
            ) : (
                <scrollbox ref={scrollRef} height={visibleHeight}>
                    {visibleItems.map((item, i) => {
                        const isSelected = i === selectedIndex;
                        const color = isSelected ? 'black' : 'white';
                        const indicatorColor = isSelected
                            ? 'black'
                            : colors.success;
                        return (
                            <box
                                key={item.key}
                                flexDirection="row"
                                height={1}
                                overflow="hidden"
                                backgroundColor={
                                    isSelected ? colors.selection : undefined
                                }
                                onMouseMove={() => setSelectedIndex(i)}
                                onMouseDown={() => handleSelect(item.key)}
                            >
                                {item.indicator && (
                                    <text
                                        selectable={false}
                                        fg={indicatorColor}
                                    >
                                        {`${item.indicator} `}
                                    </text>
                                )}
                                <text selectable={false} fg={color}>
                                    {item.label}
                                </text>
                                {item.sublabel && (
                                    <text
                                        selectable={false}
                                        fg={
                                            isSelected
                                                ? 'black'
                                                : colors.dimSeparator
                                        }
                                    >
                                        {`  ${item.sublabel}`}
                                    </text>
                                )}
                            </box>
                        );
                    })}
                </scrollbox>
            )}
        </box>
    );
}
