import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createMemoryRouter, RouterProvider } from "react-router";

import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";

import { RootLayout } from "@/layouts/root-layout";
import { ErrorBoundary } from "@/components/error-boundary";

import { Home } from "@/screens/home";
import { Session } from "@/screens/session";
import { NewSession } from "@/screens/new-session";

const NIGHTCODE_DIR = join(homedir(), ".nightcode");
const LAST_SESSION_FILE = join(NIGHTCODE_DIR, "last-session");

export const lastSession = { id: null as string | null, title: null as string | null };

function readLastSession(): { id: string; title: string } | null {
    try {
        const data = readFileSync(LAST_SESSION_FILE, "utf-8");
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function writeLastSession(data: { id: string; title: string } | null) {
    try {
        mkdirSync(NIGHTCODE_DIR, { recursive: true });
        if (data) {
            writeFileSync(LAST_SESSION_FILE, JSON.stringify(data));
        }
    } catch { /* ignore */ }
}

const savedSession = readLastSession();

const initialEntry = process.env.NIGHTCODE_SESSION_ID
    ? `/sessions/${process.env.NIGHTCODE_SESSION_ID}`
    : "/";

import { useRouteError } from "react-router";

function RouteErrorBoundary() {
    const error = useRouteError() as any;
    try {
        require("fs").writeFileSync("/Users/amaan/Desktop/Programming/night-code/error-boundary-crash.log", error?.stack || error?.message || String(error));
    } catch { /* ignore */ }
    return (
        <box flexDirection="column" padding={1} gap={1}>
            <text fg="#f38ba8">NightCode Route Error:</text>
            <text fg="#cdd6f4">{error?.message || String(error)}</text>
        </box>
    );
}

const router = createMemoryRouter([
    {
        path: "/",
        element: <RootLayout />,
        ErrorBoundary: RouteErrorBoundary,
        children: [
            { index: true, element: <Home savedSession={savedSession} /> },
            { path: "sessions/new", element: <NewSession /> },
            { path: "sessions/:id", element: <Session /> },
        ]
    }
], { initialEntries: [initialEntry] });

function App() {
    return (
        <ErrorBoundary>
            <RouterProvider router={router} />
        </ErrorBoundary>
    );
}

process.on("exit", () => {
    if (lastSession.id) {
        writeLastSession({ id: lastSession.id, title: lastSession.title ?? "" });
    }
});

const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false
});

renderer.once("destroy", () => {
    if (lastSession.id) {
        writeLastSession({ id: lastSession.id, title: lastSession.title ?? "" });
    }
});

createRoot(renderer).render(<App />);
