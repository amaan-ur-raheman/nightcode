# NightCode

> A terminal-native AI-powered IDE and coding assistant that helps you write, debug, and refactor code directly from your terminal.

---

## 🌙 What is NightCode?

NightCode is a **terminal-based AI coding assistant** that combines the power of a local AI assistant with **terminal-native UI** and **file system interaction**. It's designed for developers who prefer working in the terminal and want an intelligent assistant that can analyze, plan, and build code alongside them.

The project operates in two distinct modes:

| Mode | Description |
|------|-------------|
| **PLAN** | Read-only analysis and planning. The AI can analyze your codebase but cannot modify files. |
| **BUILD** | Full implementation mode. The AI can read, write, and edit files to implement changes. |

---

## ✨ Features

- 🤖 **AI-Powered Chat** — Interact with advanced AI models (Claude, GPT-5, Llama, etc.) directly in your terminal.
- 🖥️ **Terminal-Native UI** — Built with [`@opentui/core`](https://github.com/opentui/core) and `@opentui/react` for a seamless terminal experience.
- 🔨 **File System Tools** — Read, write, edit, and search files with built-in tools (`read-file`, `write-file`, `edit-file`, `glob`, `grep`).
- ⚡ **Bash Integration** — Execute shell commands directly from the chat.
- 💾 **Session Management** — Track conversation history, AI responses, and tool usage across sessions.
- 🗄️ **Persistent Storage** — All sessions and messages are stored in a PostgreSQL database via Prisma.
- 🔄 **Mode Switching** — Toggle between `PLAN` (read-only) and `BUILD` (full access) modes on the fly.
- 🔌 **Multi-Provider Support** — Supports Anthropic, OpenAI, and NVIDIA AI providers.
- 📡 **Streaming Responses** — Real-time streaming of AI responses and tool execution results.

---

## 🏗️ Architecture

NightCode is structured as a **monorepo** with four main packages:

```
night-code/
├── packages/
│   ├── cli/           # Terminal UI and CLI (react-like components for terminal)
│   ├── server/        # Backend server (Hono.js) — AI inference, routing, tool execution
│   ├── database/      # Database layer (Prisma + PostgreSQL) — sessions, messages
│   └── shared/        # Shared types, schemas, and utilities
```

### Package Details

| Package | Description |
|---------|-------------|
| **`@nightcode/cli`** | Terminal-native UI built with `@opentui/core` and `@opentui/react`. Uses `react-router` for navigation. Screens include Home, Session, and NewSession views with interactive menus and dialogs. |
| **`@nightcode/server`** | Backend server built with **Hono.js**. Handles AI streaming, tool execution, API routes (`/sessions`, `/chat`), and integrates with multiple AI providers. |
| **`@nightcode/database`** | Prisma ORM layer with PostgreSQL. Stores `Session`, `Message`, and related metadata with full relationship support. |
| **`@nightcode/shared`** | Shared Zod schemas, type definitions, model configurations, and utility functions used across all packages. |

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- PostgreSQL (running locally or remotely)
- API keys for your preferred AI provider (Anthropic, OpenAI, or NVIDIA)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/night-code.git
cd night-code

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL and AI provider API keys

# Generate Prisma client and push schema to database
bun run db:push

# Start the development server
bun run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start the development server |
| `bun run build` | Build all packages |
| `bun run db:push` | Push Prisma schema to database |
| `bun run db:studio` | Open Prisma Studio |
| `bun run lint` | Run ESLint |
| `bun run format` | Format code with Prettier |

---

## 🎮 Usage

### Starting a Session

```bash
bun run start
# or
bun run cli
```

### Switching Modes

- **PLAN Mode**: AI can analyze your codebase but cannot modify files.
- **BUILD Mode**: AI can read, write, and edit files to implement changes.

### Interacting with the AI

Once in a session, you can:

- Send natural language messages to the AI
- Use slash commands for specific actions
- Let the AI call tools to read/write files or execute bash commands
- View streaming responses in real-time

---

## 🔧 Configuration

### AI Providers

NightCode supports multiple AI providers. Configure your provider in the `.env` file:

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...

# NVIDIA
NVIDIA_API_KEY=nvapi-...
```

### Database

Configure your PostgreSQL connection:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/nightcode?schema=public"
```

### Supported Models

See [`packages/shared/src/Ai.ts`](packages/shared/src/Ai.ts) for the full list of supported models across providers.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **TypeScript** | Strongly typed codebase |
| **Bun** | JavaScript runtime and package manager |
| **Hono.js** | Lightweight web framework for the server |
| **@opentui/core + @opentui/react** | Terminal-native UI rendering |
| **Prisma** | ORM for database interactions |
| **PostgreSQL** | Persistent database |
| **AI SDK** | Streaming AI responses and tool calls |
| **Zod** | Runtime schema validation |
| **Sentry** | Error monitoring and tracking |
| **React Router** | Navigation in the terminal UI |

---

## 📂 Project Structure

```
night-code/
├── packages/
│   ├── cli/
│   │   ├── src/
│   │   │   ├── screens/         # Home, Session, NewSession screens
│   │   │   ├── components/      # Reusable terminal UI components
│   │   │   └── client.ts        # Main CLI entry point
│   │   └── package.json
│   ├── server/
│   │   ├── src/
│   │   │   ├── routes/          # API routes (sessions, chat)
│   │   │   ├── ai/             # AI provider integrations and tool definitions
│   │   │   ├── middleware/     # Request/response middleware
│   │   │   └── index.ts        # Server entry point
│   │   └── package.json
│   ├── database/
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Database schema definition
│   │   └── src/
│   │       └── index.ts        # Prisma client export
│   └── shared/
│       ├── src/
│       │   ├── schemas/        # Zod schemas for messages, tools, events
│       │   ├── Ai.ts           # AI provider configurations and model lists
│       │   └── types.ts        # Shared type definitions
│       └── package.json
├── package.json
├── tsconfig.base.json
└── bun.lock
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-new-feature`)
3. Commit your changes (`git commit -am 'Add my new feature'`)
4. Push to the branch (`git push origin feature/my-new-feature`)
5. Open a Pull Request

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
