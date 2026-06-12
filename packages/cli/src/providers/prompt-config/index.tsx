import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import {
    createContext,
    useContext,
    useCallback,
    useState,
    useMemo,
} from 'react';

import {
    Mode,
    DEFAULT_CHAT_MODEL_ID,
    type ModeType,
    type SupportedChatModelId,
} from '@nightcode/shared';

const PREFERENCES_PATH = join(homedir(), '.nightcode', 'preferences.json');

function getInitialModel(): string {
    try {
        const prefs = JSON.parse(
            readFileSync(PREFERENCES_PATH, 'utf-8'),
        ) as Record<string, unknown>;
        if (typeof prefs.modelId === 'string') return prefs.modelId;
    } catch {
        /* ignore */
    }
    return DEFAULT_CHAT_MODEL_ID;
}

function persistModel(modelId: string) {
    try {
        const dir = join(homedir(), '.nightcode');
        mkdirSync(dir, { recursive: true });
        let prefs: Record<string, unknown> = {};
        try {
            prefs = JSON.parse(
                readFileSync(PREFERENCES_PATH, 'utf-8'),
            ) as Record<string, unknown>;
        } catch {
            /* ignore */
        }
        writeFileSync(
            PREFERENCES_PATH,
            JSON.stringify({ ...prefs, modelId }, null, 2),
            'utf-8',
        );
    } catch {
        /* ignore */
    }
}

type PromptConfigContextValue = {
    mode: ModeType;
    toggleMode: () => void;
    setMode: (mode: ModeType) => void;
    model: string;
    setModel: (model: string) => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(
    null,
);

export function usePromptConfig(): PromptConfigContextValue {
    const value = useContext(PromptConfigContext);
    if (!value) {
        throw new Error(
            'usePromptConfig must be used within a PromptConfigProvider',
        );
    }

    return value;
}

type PromptConfigProviderProps = {
    children: ReactNode;
};

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
    const [mode, setMode] = useState<ModeType>(Mode.BUILD);
    const [model, setModel] = useState<string>(getInitialModel);

    const toggleMode = useCallback(() => {
        setMode((m) => (m === Mode.BUILD ? Mode.PLAN : Mode.BUILD));
    }, []);

    const handleSetModel = useCallback((m: string) => {
        setModel(m);
        persistModel(m);
    }, []);

    const value = useMemo(
        () => ({
            mode,
            toggleMode,
            setMode,
            model,
            setModel: handleSetModel,
        }),
        [mode, toggleMode, setMode, model, handleSetModel],
    );

    return (
        <PromptConfigContext.Provider value={value}>
            {children}
        </PromptConfigContext.Provider>
    );
}
