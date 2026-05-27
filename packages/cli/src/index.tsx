import { createRoot } from "@opentui/react";
import { createCliRenderer  } from "@opentui/core";

import { ToastProvider } from "@/providers/toast";
import { DialogProvider } from "@/providers/dialog";
import { ThemeProvider, useTheme } from "@/providers/theme";
import { KeyboardLayerProvider } from "@/providers/keyboard-layer";

import { Header } from "@/components/header";
import { InputBar } from "@/components/input-bar";

function ThemedRoot() {
    const { colors } = useTheme();

    return (
        <box
            alignItems="center"
            justifyContent="center"
            backgroundColor={colors.background}
            width="100%"
            height="100%"
            gap={2}
        >
            <Header />
            <box width="100%" maxWidth={78} paddingX={2}>
                <InputBar onSubmit={() => {}} />
            </box>
        </box>
    )
}

function App() {
    return (
        <ThemeProvider>
            <KeyboardLayerProvider>
                <DialogProvider>
                    <ToastProvider>
                        <ThemedRoot />
                    </ToastProvider>
                </DialogProvider>
            </KeyboardLayerProvider>
        </ThemeProvider>
    );
}

const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false
});
createRoot(renderer).render(<App />);
