# @nightcode/cli

> Terminal-native UI and CLI for NightCode — an AI-powered coding assistant that lives in your terminal.

---

## Overview

`@nightcode/cli` is the client-side package of NightCode. It provides a rich terminal UI built with [`@opentui/core`](https://github.com/opentui/core) and `@opentui/react`, React Router-based navigation, and 40+ AI-callable tools for file operations, git management, testing, orchestration, and more.

---

## Features

- 🖥️ **Terminal-Native UI** — React-like components rendered directly in the terminal via OpenTUI
- 🤖 **AI Chat** — Streaming conversations with tool execution and real-time responses
- 🔨 **40+ Tools** — File ops, git, bash, testing, memory, orchestration, and more
- 🐙 **Subagents** — Spawn specialized workers for testing, debugging, refactoring, and code review
- 📊 **Orchestrator** — Decompose complex tasks into a parallelized DAG of subtasks
- 🔀 **Conversation Branching** — Create branches to explore different approaches
- 📁 **File Tree** — Visual file explorer in the terminal
- ⌨️ **Command Menu** — Quick-access command palette
- 🧠 **Persistent Memory** — Remember user preferences and project context across sessions
- 🔌 **MCP Support** — Connect external Model Context Protocol servers
- 🔒 **OS Keychain** — Secure API key storage
- 📡 **Non-Interactive Mode** — Pipe-friendly CLI for scripting and automation
- 🏗️ **Project Scaffolding** — `nightcode init` with templates (basic, fullstack, api)

---

## Project Structure

```
packages/cli/
├── src/
│   ├── index.tsx              # Entry point — router setup, CLI subcommands, renderer
│   ├── screens/               # Route-level views
│   │   ├── home.tsx           # Home screen — session list, new session
│   │   ├── session.tsx        # Active chat session
│   │   └── new-session.tsx    # New session creation
│   ├── components/            # Reusable terminal UI components
│   │   ├── command-menu/      # Command palette overlay
│   │   ├── dialog/            # Modal dialog system
│   │   ├── file-mention/      # @file mention system for the input bar
│   │   ├── messages/          # Message rendering (markdown, tool results)
│   │   ├── file-tree.tsx      # File tree explorer panel
│   │   ├── input-bar.tsx      # Chat input with @mention support
│   │   ├── header.tsx         # Session header
│   │   ├── status-bar.tsx     # Mode, model, credits status
│   │   ├── branch-indicator.tsx    # Conversation branch UI
│   │   ├── task-graph.tsx     # Orchestration DAG visualization
│   │   ├── task-list-panel.tsx     # Task checklist panel
│   │   ├── subagent-progress-panel.tsx  # Subagent progress tracking
│   │   ├── file-diff-panel.tsx     # Git diff viewer
│   │   ├── tool-confirmation-overlay.tsx  # Tool approval dialogs
│   │   ├── question-overlay.tsx    # AI question prompt overlay
│   │   ├── error-boundary.tsx      # Error boundary
│   │   ├── session-shell.tsx       # Session layout wrapper
│   │   ├── onboarding-card.tsx     # First-run onboarding
│   │   ├── spinner.tsx             # Loading spinner
│   │   ├── border.tsx              # Styled border component
│   │   ├── key-hint.tsx            # Keyboard shortcut hints
│   │   ├── message-box.tsx         # Message container
│   │   ├── dialog-search-list.tsx  # Searchable list dialog
│   │   └── question-result.tsx     # Question answer display
│   ├── hooks/                 # React hooks
│   │   ├── use-chat.ts        # Chat state and message handling
│   │   ├── use-coalesced-messages.ts  # Message batching for performance
│   │   ├── use-credits.ts     # Credit balance tracking
│   │   ├── use-git-diff.ts    # Git diff state
│   │   ├── use-orchestration.ts    # Orchestration graph state
│   │   └── use-recent-commands.ts  # Command history
│   ├── layouts/               # Layout components
│   │   ├── root-layout.tsx    # Root layout with providers
│   │   └── themed-root.tsx    # Theme-aware wrapper
│   ├── providers/             # Context providers
│   │   ├── auth-provider.tsx  # Authentication context
│   │   ├── dialog/            # Dialog context
│   │   ├── file-tree/         # File tree context
│   │   ├── keyboard-layer/    # Keyboard shortcut context
│   │   ├── prompt-config/     # Prompt configuration context
│   │   ├── theme/             # Theme context
│   │   └── toast/             # Toast notification context
│   ├── lib/
│   │   ├── tools/             # 40+ AI-callable tool implementations
│   │   │   ├── index.ts       # Tool registry and exports
│   │   │   ├── read-file.ts   # File reading
│   │   │   ├── write-file.ts  # File writing
│   │   │   ├── edit-file.ts   # Targeted file editing
│   │   │   ├── bash.ts        # Shell command execution
│   │   │   ├── git.ts         # Git status/diff
│   │   │   ├── git-commit.ts  # Git commit
│   │   │   ├── git-branch.ts  # Git branch operations
│   │   │   ├── git-log.ts     # Git log
│   │   │   ├── git-blame.ts   # Git blame
│   │   │   ├── git-status-extended.ts  # Extended git status
│   │   │   ├── glob.ts        # File globbing
│   │   │   ├── grep.ts        # Content search
│   │   │   ├── code-search.ts # Symbol search
│   │   │   ├── run-tests.ts   # Test runner
│   │   │   ├── spawn-agent.ts # Subagent spawning
│   │   │   ├── preset-agents.ts  # Specialized agent presets
│   │   │   ├── orchestrator.ts    # Task orchestration
│   │   │   ├── task-list.ts   # Task checklist
│   │   │   ├── memory.ts      # Persistent memory
│   │   │   ├── keychain.ts    # OS keychain
│   │   │   ├── env-manage.ts  # .env file management
│   │   │   ├── process-manage.ts  # Process management
│   │   │   ├── secret-scan.ts # Secret detection
│   │   │   ├── undo.ts        # Undo last change
│   │   │   ├── bash-safety.ts # Bash command safety checks
│   │   │   ├── dangerous-ops.ts  # Dangerous operation detection
│   │   │   └── ...            # More tools
│   │   ├── api-client.ts      # HTTP client for server API
│   │   ├── api-keys.ts        # API key management
│   │   ├── auth.ts            # Authentication logic
│   │   ├── oauth.ts           # OAuth flow
│   │   ├── memory.ts          # Memory persistence layer
│   │   ├── mcp-client.ts      # MCP server client
│   │   ├── mcp-health.ts      # MCP server health checks
│   │   ├── mcp-scope.ts       # MCP tool scoping
│   │   ├── subagent-loop.ts   # Subagent execution loop
│   │   ├── subagent-progress.ts  # Progress tracking
│   │   ├── worker-agent.ts    # Worker agent implementation
│   │   ├── orchestrator-manager.ts  # Orchestration management
│   │   ├── batch-manager.ts   # Message batching
│   │   ├── concurrency-limit.ts  # Rate limiting
│   │   ├── request-queue.ts   # Request queuing
│   │   ├── snapshot-manager.ts  # File snapshot for undo
│   │   ├── undo-manager.ts    # Undo state management
│   │   ├── tool-analytics.ts  # Tool usage analytics
│   │   ├── audit-log.ts       # Audit logging
│   │   ├── mode-utils.ts      # PLAN/BUILD mode utilities
│   │   ├── model-utils.ts     # Model selection utilities
│   │   ├── model-names.ts     # Model display names
│   │   ├── models-api.ts      # Model API client
│   │   ├── settings.ts        # User settings
│   │   ├── workspace.ts       # Workspace detection
│   │   ├── debug.ts           # Debug logging
│   │   ├── syntax-highlight.ts  # Syntax highlighting
│   │   ├── theme-manager.ts   # Theme management
│   │   ├── markdown.tsx       # Markdown rendering
│   │   ├── diff-utils.ts      # Diff utilities
│   │   ├── glob-cache.ts      # Glob result caching
│   │   ├── safe-json.ts       # Safe JSON parsing
│   │   ├── session-utils.ts   # Session helpers
│   │   ├── image-handler.ts   # Image handling
│   │   ├── http-errors.ts     # HTTP error types
│   │   ├── upgrade.ts         # Version upgrade checks
│   │   └── skills.ts          # Skill system
│   ├── commands/              # CLI subcommands
│   │   ├── init.ts            # `nightcode init` — project scaffolding
│   │   ├── mcp.ts             # `nightcode mcp` — MCP server management
│   │   └── non-interactive.ts # `nightcode --non-interactive` — pipe mode
│   └── layouts/               # Route layouts
├── bin/                       # Compiled binary output
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## CLI Usage

```bash
# Start the interactive TUI
nightcode

# Start with an existing session
NIGHTCODE_SESSION_ID=<id> nightcode

# Initialize a new project
nightcode init my-project --template basic
nightcode init my-project --template fullstack
nightcode init my-project --template api
nightcode init --no-git

# Non-interactive mode (pipe-friendly)
echo "Explain this codebase" | nightcode --non-interactive
nightcode -n --prompt "What does this project do?"
nightcode -n --file input.txt --timeout 60000

# MCP server management
nightcode mcp add filesystem --command npx --args -y @modelcontextprotocol/server-filesystem .
nightcode mcp add remote --url http://localhost:5959/mcp
nightcode mcp list
nightcode mcp remove filesystem

# Debug mode
nightcode --debug --verbose
```

---

## Scripts

| Command             | Description                           |
| ------------------- | ------------------------------------- |
| `bun run dev`       | Start in watch mode                   |
| `bun run build`     | Build to `bin/` (minified, sourcemap) |
| `bun run test`      | Run tests with Vitest                 |
| `bun run typecheck` | Type-check with TypeScript            |

---

## Dependencies

| Package                            | Purpose                        |
| ---------------------------------- | ------------------------------ |
| `@opentui/core` + `@opentui/react` | Terminal-native UI rendering   |
| `react` + `react-router`           | Component model and navigation |
| `ai` + `@ai-sdk/react`             | AI streaming and chat          |
| `@modelcontextprotocol/sdk`        | MCP server client              |
| `hono`                             | HTTP client for server API     |
| `zod`                              | Schema validation              |
| `pretty-ms`                        | Time formatting                |
| `opentui-spinner`                  | Terminal loading spinner       |

---

## Environment

| Variable               | Description                        |
| ---------------------- | ---------------------------------- |
| `NIGHTCODE_SESSION_ID` | Resume a specific session on start |

---

## Testing

```bash
# From the monorepo root
bun run test:cli

# From this package
bun run test
bun run test:watch  # watch mode
```
