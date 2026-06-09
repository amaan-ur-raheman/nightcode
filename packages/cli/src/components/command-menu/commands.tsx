import { writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { SUPPORTED_CHAT_MODELS } from "@nightcode/shared";

import { clearAuth } from "@/lib/auth";
import { performLogin } from "@/lib/oauth";
import { openBillingPortal, openUpgradeCheckout } from "@/lib/upgrade";


import type { Command } from "@/components/command-menu/types";
import {
    AgentsDialogContent,
    ConfirmDialog,
    HelpDialogContent,
    McpDialogContent,
    ModelsDialogContent,
    SessionDialogContent,
    SkillsDialogContent,
    ThemeDialogContent
} from "@/components/dialog";

export const COMMANDS: Command[] = [
    {
        name: "help",
        description: "Show available commands and shortcuts",
        value: "/help",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Help",
                children: <HelpDialogContent />,
            });
        }
    },
    {
        name: "new",
        description: "Start a new conversation",
        value: "/new",
        action: (ctx) => {
            ctx.navigate("/");
        }
    },
    {
        name: "clear",
        description: "Clear chat history",
        value: "/clear",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Confirm Clear",
                children: (
                    <ConfirmDialog
                        message="Clear all messages in this session?"
                        onConfirm={() => {
                            ctx.clearMessages();
                            ctx.dialog.close();
                            ctx.toast.show({ message: "Chat cleared", variant: "success" });
                        }}
                        onCancel={() => ctx.dialog.close()}
                    />
                ),
            });
        }
    },
    {
        name: "forget",
        description: "Forget last session",
        value: "/forget",
        action: (ctx) => {
            try {
                mkdirSync(join(homedir(), ".nightcode"), { recursive: true });
                writeFileSync(join(homedir(), ".nightcode", "last-session"), "{}");
                ctx.toast.show({ message: "Last session forgotten", variant: "success" });
            } catch {
                ctx.toast.show({ message: "Failed to forget session", variant: "error" });
            }
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
        name: "mcp",
        description: "View connected MCP servers",
        value: "/mcp",
        action: (ctx) => {
            ctx.dialog.open({
                title: "MCP Servers",
                children: <McpDialogContent />,
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
            ctx.dialog.open({
                title: "Confirm Logout",
                children: (
                    <ConfirmDialog
                        message="Are you sure you want to sign out?"
                        onConfirm={() => {
                            clearAuth();
                            ctx.toast.show({ message: "Signed out", variant: "success" });
                        }}
                        onCancel={() => ctx.dialog.close()}
                    />
                ),
            });
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
            ctx.dialog.open({
                title: "Confirm Exit",
                children: (
                    <ConfirmDialog
                        message="Are you sure you want to quit?"
                        onConfirm={() => ctx.exit()}
                        onCancel={() => ctx.dialog.close()}
                    />
                ),
            });
        }
    }
];
