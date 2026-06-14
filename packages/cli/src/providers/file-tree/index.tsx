import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

const DEFAULT_WIDTH = 30;
const MIN_WIDTH = 20;
const MAX_WIDTH = 80;
const RESIZE_STEP = 5;

type FileTreeContextValue = {
    showFileTree: boolean;
    toggleFileTree: () => void;
    closeFileTree: () => void;
    selectedFile: string | undefined;
    setSelectedFile: (path: string | undefined) => void;
    clearSelectedFile: () => void;
    fileTreeWidth: number;
    setFileTreeWidth: (w: number) => void;
    growTree: () => void;
    shrinkTree: () => void;
    diffMode: boolean;
    openDiffMode: () => void;
    activePane: 'file-tree' | 'symbol-outline' | 'code-panel' | 'chat';
    setActivePane: (
        pane: 'file-tree' | 'symbol-outline' | 'code-panel' | 'chat',
    ) => void;
};

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function FileTreeProvider({ children }: { children: ReactNode }) {
    const [showFileTree, setShowFileTree] = useState(false);
    const [selectedFile, setSelectedFile] = useState<string | undefined>();
    const [fileTreeWidth, setFileTreeWidth] = useState(DEFAULT_WIDTH);
    const [diffMode, setDiffMode] = useState(false);
    const [activePane, setActivePane] = useState<
        'file-tree' | 'symbol-outline' | 'code-panel' | 'chat'
    >('chat');

    const toggleFileTree = useCallback(() => {
        setShowFileTree((prev) => {
            if (prev) {
                setSelectedFile(undefined);
                setDiffMode(false);
                setActivePane('chat');
            } else {
                setActivePane('file-tree');
            }
            return !prev;
        });
    }, []);

    const closeFileTree = useCallback(() => {
        setShowFileTree(false);
        setSelectedFile(undefined);
        setDiffMode(false);
        setActivePane('chat');
    }, []);

    const clearSelectedFile = useCallback(() => {
        setSelectedFile(undefined);
        setActivePane('chat');
    }, []);

    const growTree = useCallback(() => {
        setFileTreeWidth((prev) => Math.min(MAX_WIDTH, prev + RESIZE_STEP));
    }, []);

    const shrinkTree = useCallback(() => {
        setFileTreeWidth((prev) => Math.max(MIN_WIDTH, prev - RESIZE_STEP));
    }, []);

    const openDiffMode = useCallback(() => {
        setShowFileTree(true);
        setDiffMode(true);
        setSelectedFile(undefined);
        setActivePane('file-tree');
    }, []);

    return (
        <FileTreeContext.Provider
            value={{
                showFileTree,
                toggleFileTree,
                closeFileTree,
                selectedFile,
                setSelectedFile: (path) => {
                    setSelectedFile(path);
                    if (path) {
                        setActivePane('symbol-outline');
                    } else {
                        setActivePane('chat');
                    }
                },
                clearSelectedFile,
                fileTreeWidth,
                setFileTreeWidth,
                growTree,
                shrinkTree,
                diffMode,
                openDiffMode,
                activePane,
                setActivePane,
            }}
        >
            {children}
        </FileTreeContext.Provider>
    );
}

export function useFileTree(): FileTreeContextValue {
    const context = useContext(FileTreeContext);
    if (!context) {
        throw new Error('useFileTree must be used within a FileTreeProvider');
    }
    return context;
}
