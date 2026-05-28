import { createMemoryRouter, RouterProvider } from "react-router";

import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";

import { RootLayout } from "@/layouts/root-layout";

import { Home } from "@/screens/home";
import { Session } from "@/screens/session";
import { NewSession } from "@/screens/new-session";

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
]);

function App() {
    return (
        <RouterProvider router={router} />
    );
}

const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false
});
createRoot(renderer).render(<App />);
