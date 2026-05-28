import { Outlet } from "react-router";

import { ToastProvider } from "@/providers/toast";
import { DialogProvider } from "@/providers/dialog";
import { ThemeProvider } from "@/providers/theme";
import { KeyboardLayerProvider } from "@/providers/keyboard-layer";

import { ThemedRoot } from "@/layouts/themed-root";

export function RootLayout() {
    return (
        <ThemeProvider>
            <ToastProvider>
                <KeyboardLayerProvider>
                    <DialogProvider>
                            <ThemedRoot>
                                <Outlet />
                            </ThemedRoot>
                        </DialogProvider>
                    </KeyboardLayerProvider>
            </ToastProvider>
        </ThemeProvider>
    );
}
