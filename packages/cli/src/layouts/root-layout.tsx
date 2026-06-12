import { Outlet } from 'react-router';

import { ToastProvider } from '@/providers/toast';
import { DialogProvider } from '@/providers/dialog';
import { ThemeProvider } from '@/providers/theme';
import { PromptConfigProvider } from '@/providers/prompt-config';
import { KeyboardLayerProvider } from '@/providers/keyboard-layer';
import { FileTreeProvider } from '@/providers/file-tree';
import { AuthProvider } from '@/providers/auth-provider';

import { ThemedRoot } from '@/layouts/themed-root';

export function RootLayout() {
    return (
        <ThemeProvider>
            <ToastProvider>
                <AuthProvider>
                    <KeyboardLayerProvider>
                        <DialogProvider>
                            <PromptConfigProvider>
                                <FileTreeProvider>
                                    <ThemedRoot>
                                        <Outlet />
                                    </ThemedRoot>
                                </FileTreeProvider>
                            </PromptConfigProvider>
                        </DialogProvider>
                    </KeyboardLayerProvider>
                </AuthProvider>
            </ToastProvider>
        </ThemeProvider>
    );
}
