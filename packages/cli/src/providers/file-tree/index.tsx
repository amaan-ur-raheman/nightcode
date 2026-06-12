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
};

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function FileTreeProvider({ children }: { children: ReactNode }) {
    const [showFileTree, setShowFileTree] = useState(false);
    const [selectedFile, setSelectedFile] = useState<string | undefined>();
    const [fileTreeWidth, setFileTreeWidth] = useState(DEFAULT_WIDTH);
    const [diffMode, setDiffMode] = useState(false);

    const toggleFileTree = useCallback(() => {
        setShowFileTree((prev) => {
            if (prev) {
                setSelectedFile(undefined);
                setDiffMode(false);
            }
            return !prev;
        });
    }, []);

    const closeFileTree = useCallback(() => {
        setShowFileTree(false);
        setSelectedFile(undefined);
        setDiffMode(false);
    }, []);

    const clearSelectedFile = useCallback(() => {
        setSelectedFile(undefined);
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
    }, []);

    return (
        <FileTreeContext.Provider
            value={{
                showFileTree,
                toggleFileTree,
                closeFileTree,
                selectedFile,
                setSelectedFile,
                clearSelectedFile,
                fileTreeWidth,
                setFileTreeWidth,
                growTree,
                shrinkTree,
                diffMode,
                openDiffMode,
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
