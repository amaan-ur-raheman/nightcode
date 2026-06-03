import { writeFileSync, unlinkSync } from "fs";
import { createMemoryRouter, RouterProvider } from "react-router";

import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";

import { RootLayout } from "@/layouts/root-layout";

import { Home } from "@/screens/home";
import { Session } from "@/screens/session";
import { NewSession } from "@/screens/new-session";

export const lastSession = { id: null as string | null, title: null as string | null };

// Clear stale data from previous run
try { unlinkSync("/tmp/nightcode-last-session.json"); } catch { /* didn't exist */ }

const initialEntry = process.env.NIGHTCODE_SESSION_ID
    ? `/sessions/${process.env.NIGHTCODE_SESSION_ID}`
    : "/";

const router = createMemoryRouter([
    {
        path: "/",
        element: <RootLayout />,
        children: [
            { index: true, element: <Home /> },
            { path: "sessions/new", element: <NewSession /> },
            { path: "sessions/:id", element: <Session /> },
        ]
    }
], { initialEntries: [initialEntry] });

function App() {
    return (
        <RouterProvider router={router} />
    );
}

process.on("exit", () => {
    if (lastSession.id) {
        writeFileSync("/tmp/nightcode-last-session.json", JSON.stringify(lastSession));
    }
});

const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false
});

renderer.once("destroy", () => {
    if (lastSession.id) {
        writeFileSync("/tmp/nightcode-last-session.json", JSON.stringify(lastSession));
    }
});

createRoot(renderer).render(<App />);
