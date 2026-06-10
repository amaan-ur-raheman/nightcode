import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";

type FileTreeContextValue = {
    showFileTree: boolean;
    toggleFileTree: () => void;
    selectedFile: string | undefined;
    setSelectedFile: (path: string | undefined) => void;
};

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function FileTreeProvider({ children }: { children: ReactNode }) {
    const [showFileTree, setShowFileTree] = useState(false);
    const [selectedFile, setSelectedFile] = useState<string | undefined>();

    const toggleFileTree = useCallback(() => {
        setShowFileTree((prev) => !prev);
    }, []);

    return (
        <FileTreeContext.Provider value={{ showFileTree, toggleFileTree, selectedFile, setSelectedFile }}>
            {children}
        </FileTreeContext.Provider>
    );
}

export function useFileTree(): FileTreeContextValue {
    const context = useContext(FileTreeContext);
    if (!context) {
        throw new Error("useFileTree must be used within a FileTreeProvider");
    }
    return context;
}
