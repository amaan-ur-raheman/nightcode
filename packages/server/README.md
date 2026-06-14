# @nightcode/server

> Backend server for NightCode — handles AI streaming, tool execution, authentication, billing, and orchestration.

---

## Overview

`@nightcode/server` is a [Hono.js](https://hono.dev) web server that powers the NightCode AI assistant. It manages AI provider integrations (12+ providers), streaming chat, session persistence, subagent execution, task orchestration, authentication (Clerk), and billing (Polar).

---

## Features

- 🤖 **Multi-Provider AI** — Route requests to 12+ AI providers via Vercel AI SDK
- 📡 **Streaming Chat** — Real-time AI response streaming with tool execution
- 🐙 **Subagent Execution** — Run autonomous subagent workers
- 📊 **Task Orchestration** — DAG-based parallel task decomposition
- 🔐 **Authentication** — Clerk-based user auth with middleware
- 💳 **Billing & Credits** — Polar integration for credit-based billing
- 📁 **Session Management** — CRUD operations for chat sessions
- 📤 **Session Export** — Export conversation history
- 🔑 **API Key Management** — Dynamic API key configuration
- ⚡ **Request Queue** — Rate-limited request queuing per provider
- 🔄 **Prompt Optimization** — Token-efficient system prompt generation

---

## Project Structure

```
packages/server/
├── src/
│   ├── index.ts                # Server entry point — Hono app, routes, middleware
│   ├── system-prompt.ts        # Dynamic system prompt builder (PLAN/BUILD modes)
│   ├── routes/                 # API route handlers
│   │   ├── auth.ts             # Authentication routes (Clerk)
│   │   ├── chat.ts             # AI chat streaming with tool execution
│   │   ├── sessions.ts         # Session CRUD (create, list, get, delete)
│   │   ├── billing.ts          # Billing checkout, portal, credits
│   │   ├── subagent.ts         # Subagent execution endpoint
│   │   ├── orchestrator.ts     # Task orchestration endpoint
│   │   ├── export.ts           # Session export
│   │   ├── models.ts           # Model listing and availability
│   │   ├── api-keys.ts         # API key CRUD
│   │   └── __tests__/          # Route tests
│   ├── middleware/              # Hono middleware
│   │   ├── require-auth.ts     # Clerk authentication guard
│   │   ├── require-credits-balance.ts  # Credit balance check
│   │   └── __tests__/
│   ├── lib/                    # Core library modules
│   │   ├── providers.ts        # AI provider client resolution (12+ providers)
│   │   ├── zen.ts              # OpenCode Zen multi-SDK routing
│   │   ├── nim.ts              # NVIDIA NIM provider
│   │   ├── auth.ts             # Clerk auth helpers
│   │   ├── credits.ts          # Credit balance management
│   │   ├── polar.ts            # Polar billing integration
│   │   ├── models.ts           # Model utilities
│   │   ├── model-fetcher.ts    # Dynamic model list fetching
│   │   ├── prompt-optimizer.ts # System prompt token optimization
│   │   ├── generate-session-title.ts  # AI-powered session title generation
│   │   ├── request-queue.ts    # Per-provider request queuing
│   │   ├── fallback.ts         # Fallback model routing
│   │   ├── debug.ts            # Debug logging
│   │   ├── _typetest.ts        # Type-level tests
│   │   └── __tests__/
│   └── __tests__/              # Integration tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## API Routes

| Route               | Method | Auth | Description                |
| ------------------- | ------ | ---- | -------------------------- |
| `/auth/*`           | \*     | ✗    | Authentication callbacks   |
| `/sessions`         | GET    | ✓    | List user sessions         |
| `/sessions`         | POST   | ✓    | Create new session         |
| `/sessions/:id`     | GET    | ✓    | Get session with messages  |
| `/sessions/:id`     | DELETE | ✓    | Delete session             |
| `/chat/*`           | POST   | ✓    | AI chat streaming          |
| `/subagent/*`       | POST   | ✓    | Execute subagent task      |
| `/orchestrator/*`   | POST   | ✓    | Run task orchestration     |
| `/billing/checkout` | POST   | ✓    | Create Polar checkout      |
| `/billing/portal`   | POST   | ✓    | Open Polar customer portal |
| `/billing/credits`  | GET    | ✓    | Get credit balance         |
| `/export/*`         | GET    | ✓    | Export session data        |
| `/models`           | GET    | ✗    | List available models      |
| `/api-keys`         | \*     | ✓    | Manage API keys            |

---

## Supported Providers

The server resolves AI provider clients dynamically based on model ID:

| Provider     | SDK Package                 | Base URL                                           |
| ------------ | --------------------------- | -------------------------------------------------- |
| NVIDIA NIM   | `@ai-sdk/openai-compatible` | `https://integrate.api.nvidia.com/v1`              |
| Anthropic    | `@ai-sdk/anthropic`         | `https://api.anthropic.com/v1`                     |
| OpenAI       | `@ai-sdk/openai`            | `https://api.openai.com/v1`                        |
| Groq         | `@ai-sdk/groq`              | `https://api.groq.com/openai/v1`                   |
| OpenCode Zen | `@ai-sdk/openai-compatible` | `https://opencode.ai/zen`                          |
| OpenRouter   | `@ai-sdk/openai-compatible` | `https://openrouter.ai/api/v1`                     |
| Together     | `@ai-sdk/openai-compatible` | `https://api.together.xyz/v1`                      |
| Fireworks    | `@ai-sdk/openai-compatible` | `https://api.fireworks.ai/inference/v1`            |
| Cerebras     | `@ai-sdk/openai-compatible` | `https://api.cerebras.ai/v1`                       |
| DeepSeek     | `@ai-sdk/openai-compatible` | `https://api.deepseek.com/v1`                      |
| Gemini       | `@ai-sdk/google`            | `https://generativelanguage.googleapis.com/v1beta` |
| Kilo         | `@ai-sdk/openai-compatible` | `https://api.kilo.ai/api/gateway`                  |

---

## Architecture

### Request Flow

```
Client Request
    │
    ▼
┌─────────────────────┐
│  Hono Middleware     │  ← Logging, CORS
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Auth Middleware     │  ← Clerk JWT verification
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Route Handler       │  ← /chat, /sessions, /billing, etc.
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Provider Resolution │  ← Model ID → Provider SDK client
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Request Queue       │  ← Per-provider rate limiting
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  AI SDK Streaming    │  ← Tool calls, response chunks
└─────────────────────┘
```

### System Prompt

The system prompt is dynamically built based on the active mode (`PLAN` or `BUILD`). It includes:

- Mode-specific rules and tool permissions
- Project context from the workspace
- Tool usage guidelines
- Subagent spawning instructions
- Orchestrator capabilities (BUILD mode only)
- Persistent memory instructions

A lean subagent variant strips non-essential sections to save ~400 tokens per subagent call.

---

## Scripts

| Command             | Description                     |
| ------------------- | ------------------------------- |
| `bun run dev`       | Start with hot reload (`--hot`) |
| `bun run build`     | Build to `dist/`                |
| `bun run test`      | Run tests with Vitest           |
| `bun run typecheck` | Type-check with TypeScript      |

---

## Dependencies

| Package                     | Purpose                             |
| --------------------------- | ----------------------------------- |
| `hono`                      | Web framework                       |
| `ai`                        | Vercel AI SDK — streaming & tools   |
| `@ai-sdk/anthropic`         | Anthropic provider                  |
| `@ai-sdk/openai`            | OpenAI provider                     |
| `@ai-sdk/groq`              | Groq provider                       |
| `@ai-sdk/google`            | Google Gemini provider              |
| `@ai-sdk/openai-compatible` | Generic OpenAI-compatible providers |
| `@ai-sdk/provider`          | Provider type definitions           |
| `@clerk/backend`            | Clerk authentication                |
| `@polar-sh/sdk`             | Polar billing                       |
| `@nightcode/database`       | Prisma database client              |
| `@nightcode/shared`         | Shared schemas and types            |
| `zod`                       | Schema validation                   |
| `dotenv`                    | Environment variable loading        |

---

## Environment Variables

| Variable             | Description                       |
| -------------------- | --------------------------------- |
| `PORT`               | Server port (default: `5959`)     |
| `DATABASE_URL`       | PostgreSQL connection string      |
| `CLERK_SECRET_KEY`   | Clerk backend secret key          |
| `POLAR_ACCESS_TOKEN` | Polar API access token            |
| `*_API_KEY`          | AI provider API keys (see shared) |

---

## Testing

```bash
# From the monorepo root
bun run test:server

# From this package
bun run test
bun run test:watch  # watch mode
```
