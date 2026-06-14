# NightCode

> A terminal-native AI-powered IDE and coding assistant that helps you write, debug, and refactor code directly from your terminal.

---

## 🌙 What is NightCode?

NightCode is a **terminal-based AI coding assistant** that combines the power of a local AI assistant with **terminal-native UI** and **file system interaction**. It's designed for developers who prefer working in the terminal and want an intelligent assistant that can analyze, plan, and build code alongside them.

The project operates in two distinct modes:

| Mode      | Description                                                                                |
| --------- | ------------------------------------------------------------------------------------------ |
| **PLAN**  | Read-only analysis and planning. The AI can analyze your codebase but cannot modify files. |
| **BUILD** | Full implementation mode. The AI can read, write, and edit files to implement changes.     |

---

## ✨ Features

- 🤖 **AI-Powered Chat** — Interact with advanced AI models directly in your terminal via 12+ providers (NVIDIA NIM, Anthropic, OpenAI, Groq, OpenCode Zen, OpenRouter, Together, Fireworks, Cerebras, DeepSeek, Gemini, and Kilo).
- 🖥️ **Terminal-Native UI** — Built with [`@opentui/core`](https://github.com/opentui/core) and `@opentui/react` for a seamless terminal experience.
- 🔨 **40+ Built-in Tools** — Read, write, edit, search, run tests, manage git, scan secrets, spawn subagents, and more — all callable by the AI.
- ⚡ **Bash Integration** — Execute shell commands directly from the chat.
- 💾 **Session Management** — Track conversation history, AI responses, and tool usage across sessions with **conversation branching**.
- 🗄️ **Persistent Storage** — Sessions and messages are stored in PostgreSQL via Prisma.
- 🔄 **Mode Switching** — Toggle between `PLAN` (read-only) and `BUILD` (full access) modes on the fly.
- 🐙 **Subagents & Orchestrator** — Spawn specialized subagents for testing, debugging, refactoring, and code review, or let the orchestrator decompose complex tasks into a parallelized DAG.
- 🧠 **Persistent Memory** — The AI remembers user preferences, project context, and configuration across sessions.
- 🔌 **MCP Support** — Connect external Model Context Protocol servers via `nightcode mcp`.
- 🔒 **OS Keychain Integration** — Store API keys securely in your OS keychain.
- 🔐 **Authentication & Billing** — Clerk authentication with Polar-based credit billing.
- 📡 **Streaming Responses** — Real-time streaming of AI responses and tool execution results.
- 🌿 **Git Integration** — Full git support (status, branch, commit, log, blame, diff) with a visual branch indicator.

---

## 🏗️ Architecture

NightCode is structured as a **monorepo** with four main packages:

```
night-code/
├── packages/
│   ├── cli/           # Terminal UI and CLI (React-like components for terminal)
│   ├── server/        # Backend server (Hono.js) — AI inference, routing, tool execution
│   ├── database/      # Database layer (Prisma + PostgreSQL) — sessions, messages
│   └── shared/        # Shared types, schemas, tool contracts, and utilities
```

### Package Details

| Package                   | Description                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@nightcode/cli`**      | Terminal-native UI built with `@opentui/core` and `@opentui/react`. Uses `react-router` for navigation. Screens include Home, Session, and NewSession views with interactive menus, dialogs, command palette, file tree, and more. |
| **`@nightcode/server`**   | Backend server built with **Hono.js**. Handles AI streaming, tool execution, API routes (`/chat`, `/sessions`, `/billing`, `/subagent`, `/orchestrator`, `/export`, `/models`, `/api-keys`), and integrates with 12+ AI providers. |
| **`@nightcode/database`** | Prisma ORM layer with PostgreSQL. Stores `Session` with JSON messages, conversation branches, and indexing for efficient queries.                                                                                                  |
| **`@nightcode/shared`**   | Shared Zod schemas, tool input contracts, type definitions, model configurations, task graph implementation, keychain utilities, and provider key management.                                                                      |

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- PostgreSQL (running locally or remotely)
- API keys for your preferred AI provider

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/night-code.git
cd night-code

# Install dependencies (also generates Prisma client)
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL and AI provider API keys

# Push Prisma schema to database
bunx prisma migrate dev --name init

# Start the development server (server + CLI via mprocs)
bun run start
```

### Available Scripts

| Command               | Description                               |
| --------------------- | ----------------------------------------- |
| `bun run dev`         | Start the backend dev server (hot reload) |
| `bun run dev:server`  | Start the backend dev server              |
| `bun run dev:cli`     | Start the CLI in dev mode (watch mode)    |
| `bun run start`       | Start both server and CLI via mprocs      |
| `bun run build`       | Build all packages                        |
| `bun run build:cli`   | Build the CLI for distribution            |
| `bun run link:cli`    | Build and globally link the CLI           |
| `bun run test`        | Run all tests                             |
| `bun run test:cli`    | Run CLI tests                             |
| `bun run test:server` | Run server tests                          |
| `bun run typecheck`   | Type-check all packages                   |
| `bun run lint`        | Run ESLint                                |
| `bun run format`      | Format code with Prettier                 |

---

## 🎮 Usage

### CLI Commands

```bash
# Start the interactive TUI
nightcode

# Initialize a new NightCode project
nightcode init my-project
nightcode init my-project --template basic   # basic | fullstack | api
nightcode init --no-git                       # skip git initialization

# Non-interactive mode (pipe-friendly)
echo "What is 2+2?" | nightcode --non-interactive
nightcode -n --prompt "Explain this codebase"
nightcode -n --file input.txt

# Manage MCP servers
nightcode mcp add filesystem --command npx --args -y @modelcontextprotocol/server-filesystem .
nightcode mcp add remote --url http://localhost:5959/mcp
nightcode mcp list
nightcode mcp remove filesystem

# Debug mode
nightcode --debug --verbose
```

### Switching Modes

- **PLAN Mode**: AI can analyze your codebase but cannot modify files.
- **BUILD Mode**: AI can read, write, and edit files to implement changes.

### Interacting with the AI

Once in a session, you can:

- Send natural language messages to the AI
- Use the command menu for quick actions
- Let the AI call tools to read/write files, run tests, manage git, or execute bash commands
- View streaming responses in real-time
- Create conversation branches to explore different approaches

---

## 🔧 Built-in Tools

NightCode provides **40+ tools** that the AI can call during conversations:

### File Operations

| Tool              | Description                                  |
| ----------------- | -------------------------------------------- |
| `readFile`        | Read file contents with optional line ranges |
| `writeFile`       | Create or overwrite files                    |
| `editFile`        | Targeted edits with exact string replacement |
| `createFile`      | Create a new file (errors if exists)         |
| `deleteFile`      | Delete files or empty directories            |
| `moveFile`        | Move or rename files                         |
| `glob`            | Find files matching glob patterns            |
| `grep`            | Search file contents with regex              |
| `listDirectory`   | List directory entries                       |
| `fileInfo`        | Get file metadata (size, line count, etc.)   |
| `tree`            | Display directory tree                       |
| `getOutline`      | List top-level symbols in a file             |
| `diffFiles`       | Unified diff between two files               |
| `searchReplace`   | Find and replace across multiple files       |
| `renameSymbol`    | AST-aware symbol rename across files         |
| `patch`           | Apply unified diff patches                   |
| `createDirectory` | Create directories with parents              |

### Shell & Commands

| Tool   | Description            |
| ------ | ---------------------- |
| `bash` | Execute shell commands |

### Git Operations

| Tool        | Description              |
| ----------- | ------------------------ |
| `gitStatus` | Show working tree status |
| `gitDiff`   | Show git diff for files  |

### AI & Orchestration

| Tool                | Description                             |
| ------------------- | --------------------------------------- |
| `spawnAgent`        | Delegate tasks to a subagent            |
| `spawnTestWriter`   | Write tests for given files             |
| `spawnDebugger`     | Debug an issue with root cause analysis |
| `spawnRefactor`     | Refactor code without changing behavior |
| `spawnCodeReviewer` | Review code for bugs and best practices |
| `spawnResearcher`   | Explore codebase architecture           |
| `orchestrator`      | Decompose tasks into a parallelized DAG |
| `getTaskStatus`     | Monitor orchestration progress          |
| `cancelTask`        | Stop a running orchestration            |
| `taskList`          | Create a visible task checklist         |

### Utilities

| Tool             | Description                                    |
| ---------------- | ---------------------------------------------- |
| `askQuestion`    | Prompt the user with choices or free text      |
| `tokenCount`     | Count tokens and estimate API cost             |
| `webFetch`       | Fetch a remote URL                             |
| `httpRequest`    | Make HTTP requests (GET/POST/PUT/PATCH/DELETE) |
| `codeSearch`     | Search for symbol definitions across codebase  |
| `memorySet`      | Store persistent memory across sessions        |
| `memoryGet`      | Retrieve persistent memory                     |
| `memoryDelete`   | Delete persistent memory                       |
| `memoryList`     | List all stored memories                       |
| `memorySearch`   | Search memories by key or value                |
| `envManage`      | Read, add, update, delete env vars in .env     |
| `keychainSet`    | Store secrets in OS keychain                   |
| `keychainGet`    | Retrieve secrets from OS keychain              |
| `keychainDelete` | Delete secrets from OS keychain                |
| `processManage`  | List/kill dev server processes and ports       |
| `secretScan`     | Scan files for accidentally committed secrets  |
| `undo`           | Undo the last file modification                |

---

## 📡 Supported Providers & Models

### Providers

| Provider         | Base URL                                           | Notes                  |
| ---------------- | -------------------------------------------------- | ---------------------- |
| **NVIDIA NIM**   | `https://integrate.api.nvidia.com/v1`              | Free models available  |
| **Anthropic**    | `https://api.anthropic.com/v1`                     | Claude models          |
| **OpenAI**       | `https://api.openai.com/v1`                        | GPT & o-series models  |
| **Groq**         | `https://api.groq.com/openai/v1`                   | Fast inference         |
| **OpenCode Zen** | `https://opencode.ai/zen`                          | Free + paid models     |
| **OpenRouter**   | `https://openrouter.ai/api/v1`                     | Multi-provider gateway |
| **Together**     | `https://api.together.xyz/v1`                      | Open-source models     |
| **Fireworks**    | `https://api.fireworks.ai/inference/v1`            | Fast inference         |
| **Cerebras**     | `https://api.cerebras.ai/v1`                       | Fast inference         |
| **DeepSeek**     | `https://api.deepseek.com/v1`                      | DeepSeek models        |
| **Gemini**       | `https://generativelanguage.googleapis.com/v1beta` | Google models          |
| **Kilo**         | `https://api.kilo.ai/api/gateway`                  | Multi-model gateway    |

### Notable Models

- **NVIDIA NIM** (free): Nemotron 3 Ultra 550B, DeepSeek V4 Flash/Pro, Qwen 3.5, MiniMax M2.7, GLM 5.1, Llama 4 Maverick
- **Anthropic**: Claude Sonnet 4, Claude 3.5 Haiku
- **OpenAI**: GPT-4o, GPT-4o Mini, o3-mini
- **OpenCode Zen** (free): DeepSeek V4 Flash, Nemotron 3 Ultra, Mimo V2.5
- **OpenCode Zen** (paid): GPT-5.5, GPT-5.4, Claude Opus 4, Claude Sonnet 4, Gemini 3.5 Flash

See [`packages/shared/src/models.ts`](packages/shared/src/models.ts) for the full list of supported models.

---

## ⚙️ Configuration

### AI Providers

NightCode supports multiple AI providers. Configure your provider API keys via the CLI settings or environment variables:

```env
# Direct API keys (fallback if not set via client settings)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
NVIDIA_API_KEY=nvapi-...
GROQ_API_KEY=gsk_...
```

API keys can also be stored securely in your OS keychain (macOS Keychain, Linux secret-tool) via the `keychainSet` tool.

### Database

Configure your PostgreSQL connection:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/nightcode?schema=public"
```

---

## 🛠️ Tech Stack

| Technology                         | Purpose                                  |
| ---------------------------------- | ---------------------------------------- |
| **TypeScript**                     | Strongly typed codebase                  |
| **Bun**                            | JavaScript runtime and package manager   |
| **Hono.js**                        | Lightweight web framework for the server |
| **@opentui/core + @opentui/react** | Terminal-native UI rendering             |
| **Prisma**                         | ORM for database interactions            |
| **PostgreSQL**                     | Persistent database                      |
| **Vercel AI SDK**                  | Streaming AI responses and tool calls    |
| **Zod**                            | Runtime schema validation                |
| **Clerk**                          | Authentication                           |
| **Polar**                          | Billing and credits                      |
| **mprocs**                         | Process manager for concurrent dev       |
| **React Router**                   | Navigation in the terminal UI            |
| **React**                          | Component model for terminal UI          |

---

## 📂 Project Structure

```
night-code/
├── packages/
│   ├── cli/
│   │   ├── src/
│   │   │   ├── index.tsx            # CLI entry point (router, renderer, subcommands)
│   │   │   ├── screens/             # Home, Session, NewSession screens
│   │   │   ├── components/          # Terminal UI components
│   │   │   │   ├── command-menu/    # Command palette
│   │   │   │   ├── dialog/          # Modal dialogs
│   │   │   │   ├── file-mention/    # @file mention system
│   │   │   │   ├── messages/        # Message rendering
│   │   │   │   ├── file-tree.tsx    # File tree explorer
│   │   │   │   ├── input-bar.tsx    # Chat input
│   │   │   │   ├── status-bar.tsx   # Status bar
│   │   │   │   ├── task-graph.tsx   # Orchestration graph visualization
│   │   │   │   └── ...              # 20+ more components
│   │   │   ├── hooks/               # React hooks (use-chat, use-credits, use-git-diff, etc.)
│   │   │   ├── layouts/             # Root and themed root layouts
│   │   │   ├── providers/           # Auth, theme, dialog, toast, keyboard providers
│   │   │   ├── lib/
│   │   │   │   ├── tools/           # 40+ AI-callable tool implementations
│   │   │   │   ├── api-client.ts    # HTTP client for server API
│   │   │   │   ├── auth.ts          # Authentication logic
│   │   │   │   ├── mcp-client.ts    # MCP server client
│   │   │   │   ├── memory.ts        # Persistent memory system
│   │   │   │   ├── orchestrator-manager.ts  # Task orchestration
│   │   │   │   ├── subagent-loop.ts # Subagent execution
│   │   │   │   └── ...              # 30+ utility modules
│   │   │   └── commands/            # CLI subcommands (init, mcp, non-interactive)
│   │   └── bin/                     # Compiled binary output
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts             # Server entry point (Hono app)
│   │   │   ├── system-prompt.ts     # Dynamic system prompt builder
│   │   │   ├── routes/              # API routes
│   │   │   │   ├── chat.ts          # AI chat streaming
│   │   │   │   ├── sessions.ts      # Session CRUD
│   │   │   │   ├── billing.ts       # Credits & checkout
│   │   │   │   ├── subagent.ts      # Subagent execution
│   │   │   │   ├── orchestrator.ts  # Task orchestration
│   │   │   │   ├── export.ts        # Session export
│   │   │   │   ├── models.ts        # Model listing
│   │   │   │   ├── api-keys.ts      # API key management
│   │   │   │   └── auth.ts          # Auth routes
│   │   │   ├── middleware/          # Auth middleware
│   │   │   └── lib/
│   │   │       ├── providers.ts     # AI provider client resolution
│   │   │       ├── zen.ts           # OpenCode Zen multi-SDK routing
│   │   │       ├── polar.ts         # Billing integration
│   │   │       ├── credits.ts       # Credit management
│   │   │       ├── auth.ts          # Clerk auth helpers
│   │   │       ├── models.ts        # Model utilities
│   │   │       └── ...              # More utilities
│   ├── database/
│   │   ├── prisma/
│   │   │   └── schema.prisma        # Database schema
│   │   └── src/
│   │       ├── index.ts             # Prisma client export
│   │       └── client.ts            # Database client setup
│   └── shared/
│       └── src/
│           ├── index.ts             # Public API exports
│           ├── models.ts            # Model definitions & pricing
│           ├── schemas.ts           # Zod schemas, tool contracts, modes
│           ├── task-graph.ts        # DAG-based task graph implementation
│           ├── keychain.ts          # OS keychain integration
│           └── provider-keys.ts     # Provider key resolution
├── package.json
├── tsconfig.base.json
├── eslint.config.js
├── mprocs.yaml                      # Concurrent process config
└── bun.lock
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-new-feature`)
3. Run the development environment: `bun run start`
4. Make your changes and run tests: `bun run test`
5. Type-check: `bun run typecheck`
6. Lint: `bun run lint`
7. Commit your changes (`git commit -am 'Add my new feature'`)
8. Push to the branch (`git push origin feature/my-new-feature`)
9. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <p>Built with ❤️ for developers who live in the terminal</p>
  <p>
    <a href="https://github.com/your-username/night-code">GitHub</a> ·
    <a href="https://github.com/your-username/night-code/issues">Issues</a> ·
    <a href="https://github.com/your-username/night-code/discussions">Discussions</a>
  </p>
</div>
