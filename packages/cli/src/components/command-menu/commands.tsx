import { SUPPORTED_CHAT_MODELS } from "@nightcode/shared";

import { clearAuth } from "@/lib/auth";
import { performLogin } from "@/lib/oauth";
import { openBillingPortal, openUpgradeCheckout } from "@/lib/upgrade";


import type { Command } from "@/components/command-menu/types";
import {
    AgentsDialogContent,
    ModelsDialogContent,
    SessionDialogContent,
    SkillsDialogContent,
    ThemeDialogContent
} from "@/components/dialog";

export const COMMANDS: Command[] = [
    {
        name: "new",
        description: "Start a new conversation",
        value: "/new",
        action: (ctx) => {
            ctx.navigate("/");
        }
    },
    {
        name: "agents",
        description: "Switch agents",
        value: "/agents",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Agent",
                children: <AgentsDialogContent currentMode={ctx.mode} onSelectMode={ctx.setMode} />
            })
        }
    },
    {
        name: "models",
        description: "Select AI model for generation",
        value: "/models",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Model",
                children: (
                    <ModelsDialogContent
                        models={SUPPORTED_CHAT_MODELS.map((model) => model.id)}
                        onSelectModel={ctx.setModel}
                    />
                ),
            })
        }
    },
    {
        name: "sessions",
        description: "Browse past sessions",
        value: "/sessions",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Sessions",
                children: <SessionDialogContent />,
            })
        }
    },
    {
        name: "theme",
        description: "Change the theme",
        value: "/theme",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Theme",
                children: <ThemeDialogContent />,
            })
        }
    },
    {
        name: "skills",
        description: "Use a prompt skill",
        value: "/skills",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Skill",
                children: <SkillsDialogContent onSelectSkill={ctx.setInputValue} />,
            })
        }
    },
    {
        name: "login",
        description: "Sign in with your browser",
        value: "/login",
        action: async (ctx) => {
            ctx.toast.show({ message: "Opening browser to login..." });

            try {
                await performLogin();
                ctx.toast.show({ message: "Login successful", variant: "success" });
            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : "Sign in failed or timed out";

                ctx.toast.show({ variant: "error", message });
            }
        }
    },
    {
        name: "logout",
        description: "Sign out of your account",
        value: "/logout",
        action: (ctx) => {
            clearAuth();
            ctx.toast.show({ message: "Signed out", variant: "success" });
        }
    },
    {
        name: "upgrade",
        description: "Buy more credits",
        value: "/upgrade",
        action: async (ctx) => {
            ctx.toast.show({ message: "Opening credits checkout..." })

            try {
                await openUpgradeCheckout();
                ctx.toast.show({
                    variant: "success",
                    message: "Checkout opened in browser",
                });
            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : "Failed to open checkout";

                ctx.toast.show({ variant: "error", message });
            }
        }
    },
    {
        name: "usage",
        description: "Open billing portal in the browser",
        value: "/usage",
        action: async (ctx) => {
            ctx.toast.show({ message: "Opening billing portal..." });

            try {
                await openBillingPortal();
                ctx.toast.show({
                    variant: "success",
                    message: "Billing portal opened in browser",
                });
            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : "Failed to open billing portal";

                ctx.toast.show({ variant: "error", message });
            }
        }
    },
    {
        name: "exit",
        description: "Quit the application",
        value: "/exit",
        action: (ctx) => {
            ctx.exit();
        }
    }
];
