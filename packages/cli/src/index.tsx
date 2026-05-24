import { createCliRenderer  } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { ToastProvider } from "@/providers/toast";
import { DialogProvider } from "@/providers/dialog";
import { KeyboardLayerProvider } from "@/providers/keyboard-layer";

import { Header } from "@/components/header";
import { InputBar } from "@/components/input-bar";

function App() {
    return (
        <KeyboardLayerProvider>
            <DialogProvider>
                <ToastProvider>
                    <box
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor="#0D0D12"
                        width="100%"
                        height="100%"
                        gap={2}
                    >
                        <Header />
                        <box width="100%" maxWidth={78} paddingX={2}>
                            <InputBar onSubmit={() => {}} />
                        </box>
                    </box>
                </ToastProvider>
            </DialogProvider>
        </KeyboardLayerProvider>
    );
}

const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false
});
createRoot(renderer).render(<App />);
