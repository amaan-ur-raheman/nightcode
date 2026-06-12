# @nightcode/shared

> Shared types, schemas, tool contracts, and utilities for the NightCode monorepo.

---

## Overview

`@nightcode/shared` is the foundation package used by both `@nightcode/cli` and `@nightcode/server`. It defines AI model configurations, tool input schemas (Zod), conversation modes, OS keychain integration, provider key management, and the task graph engine for orchestration.

---

## Features

- 📐 **Zod Schemas** — Type-safe tool input validation for 40+ tools
- 🤖 **Model Registry** — Supported models across 12+ providers with pricing
- 🔄 **Mode System** — `PLAN` and `BUILD` mode definitions and tool contracts
- 🔑 **Keychain** — OS keychain integration (macOS Keychain, Linux secret-tool)
- 🔧 **Provider Keys** — API key resolution by provider
- 📊 **Task Graph** — DAG-based task graph engine for orchestration

---

## Project Structure

```
packages/shared/
├── src/
│   ├── index.ts            # Public API — re-exports all modules
│   ├── schemas.ts          # Zod schemas, tool contracts, mode definitions
│   ├── models.ts           # Model definitions, pricing, provider types
│   ├── keychain.ts         # OS keychain manager (macOS + Linux)
│   ├── provider-keys.ts    # Provider-to-keychain/env mapping
│   ├── task-graph.ts       # Task graph engine (create, schedule, cancel)
│   └── __tests__/          # Unit tests
│       ├── keychain.test.ts
│       ├── models.test.ts
│       ├── provider-keys.test.ts
│       ├── schemas.test.ts
│       └── task-graph.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Modules

### Schemas (`schemas.ts`)

Defines all tool input schemas using Zod, conversation types, and mode-aware tool contracts.

**Types:**

- `MessageContent` — Text or image content
- `ConversationBranch` — Branch metadata for conversation forking
- `ModeType` — `"BUILD"` | `"PLAN"`

**Tool Schemas (`toolInputSchemas`):**

40+ Zod schemas for every tool the AI can call:

| Category      | Tools                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File Ops      | `readFile`, `writeFile`, `editFile`, `createFile`, `deleteFile`, `moveFile`, `createDirectory`                                                                              |
| Search        | `glob`, `grep`, `codeSearch`, `getOutline`, `diffFiles`                                                                                                                     |
| Shell         | `bash`, `runTests`                                                                                                                                                          |
| Git           | `gitStatus`, `gitDiff`, `gitCommit`, `gitBranch`, `gitLog`, `gitBlame`, `gitStatusExtended`                                                                                 |
| AI/Agents     | `spawnAgent`, `spawnTestWriter`, `spawnDebugger`, `spawnRefactor`, `spawnCodeReviewer`, `spawnResearcher`                                                                   |
| Orchestration | `orchestrator`, `getTaskStatus`, `cancelTask`, `taskList`                                                                                                                   |
| Memory        | `memorySet`, `memoryGet`, `memoryDelete`, `memoryList`, `memorySearch`                                                                                                      |
| Security      | `keychainSet`, `keychainGet`, `keychainDelete`, `secretScan`                                                                                                                |
| Utilities     | `tokenCount`, `webFetch`, `httpRequest`, `askQuestion`, `envManage`, `processManage`, `undo`, `patch`, `searchReplace`, `renameSymbol`, `listDirectory`, `fileInfo`, `tree` |

**Tool Contracts:**

```typescript
// PLAN mode — read-only tools only
const readOnlyToolContracts = { readFile, listDirectory, glob, grep, ... };

// BUILD mode — all tools including write operations
const buildToolContracts = { ...readOnlyToolContracts, writeFile, editFile, bash, ... };

// Subagent contracts — excludes spawn/orchestration/undo tools
function getSubagentToolContracts(mode: ModeType) { ... }
```

### Models (`models.ts`)

Defines supported AI models, providers, and pricing.

**Providers (`SupportedProvider`):**

| Provider     | Prefix        | Notes                  |
| ------------ | ------------- | ---------------------- |
| `nvidia`     | `nvidia/`     | Free models available  |
| `anthropic`  |               | Claude models          |
| `openai`     |               | GPT & o-series         |
| `groq`       |               | Fast inference         |
| `opencode`   | `opencode/`   | Free + paid via Zen    |
| `openrouter` | `openrouter/` | Multi-provider gateway |
| `together`   | `together/`   | Open-source models     |
| `fireworks`  | `fireworks/`  | Fast inference         |
| `cerebras`   | `cerebras/`   | Fast inference         |
| `deepseek`   | `deepseek/`   | DeepSeek models        |
| `gemini`     | `gemini/`     | Google models          |
| `kilo`       | `kilo/`       | Multi-model gateway    |

**Key Exports:**

```typescript
SUPPORTED_CHAT_MODELS; // Array of all hardcoded models with pricing
DEFAULT_CHAT_MODEL_ID; // 'nvidia/stepfun-ai/step-3.7-flash'
findSupportedChatModel(id); // Look up a model by ID
```

### Keychain (`keychain.ts`)

Cross-platform OS keychain integration:

```typescript
import { keychain } from '@nightcode/shared';

// Store a secret
await keychain.setKey('openai-api-key', 'sk-...');

// Retrieve a secret
const key = await keychain.getKey('openai-api-key');

// Delete a secret
await keychain.deleteKey('openai-api-key');

// Check availability
keychain.isAvailable(); // true on macOS/Linux
```

**Platform Support:**

- **macOS** — Uses `security` CLI (Keychain)
- **Linux** — Uses `secret-tool` (GNOME Keyring / KDE Wallet)
- **Windows** — Not supported (returns `false`)

### Provider Keys (`provider-keys.ts`)

Maps providers to their keychain account names and environment variables:

```typescript
PROVIDER_KEYCHAIN_NAMES.nvidia; // 'nim-api-key'
PROVIDER_KEYCHAIN_NAMES.openai; // 'openai-api-key'
PROVIDER_ENV_VARS.openai; // 'OPENAI_API_KEY'

resolveProviderForModel('nvidia/meta/llama-3.3-70b-instruct'); // 'nvidia'
resolveProviderForModel('gpt-4o'); // 'openai'
getKeychainName('anthropic'); // 'anthropic-api-key'
```

### Task Graph (`task-graph.ts`)

A DAG-based task graph engine for orchestrating parallel subtasks:

```typescript
import {
    createTaskGraph,
    getReadyTasks,
    markTaskRunning,
    markTaskCompleted,
    markTaskFailed,
    cancelTask,
    getTopologicalOrder,
    getCriticalPath,
    getGraphStats,
    validateGraph,
} from '@nightcode/shared';

// Create a graph
const graph = createTaskGraph('Refactor auth', [
    {
        id: 'a',
        type: 'researcher',
        description: 'Analyze auth code',
        dependencies: [],
        files: [],
        mode: 'PLAN',
    },
    {
        id: 'b',
        type: 'coder',
        description: 'Refactor auth',
        dependencies: ['a'],
        files: [],
        mode: 'BUILD',
    },
    {
        id: 'c',
        type: 'reviewer',
        description: 'Review changes',
        dependencies: ['b'],
        files: [],
        mode: 'PLAN',
    },
]);

// Schedule ready tasks (no unmet dependencies)
const ready = getReadyTasks(graph); // → [task 'a']

// Track execution
markTaskRunning(graph, 'a', 'agent-1');
markTaskCompleted(graph, 'a', 'Found 3 issues');
markTaskRunning(graph, 'b', 'agent-2');
// ... etc

// Analytics
getTopologicalOrder(graph); // ['a', 'b', 'c']
getCriticalPath(graph); // Longest dependency chain
getGraphStats(graph); // { total: 3, completed: 1, progress: 33, ... }
validateGraph(graph); // [] if valid
```

**Features:**

- Automatic edge building from dependency arrays
- Exponential backoff retry (configurable per task)
- Downstream cancellation on failure
- Version counter for React reactivity
- Cycle detection and graph validation
- Critical path analysis

---

## Scripts

| Command              | Description                |
| -------------------- | -------------------------- |
| `bun run typecheck`  | Type-check with TypeScript |
| `bun run test`       | Run tests with Vitest      |
| `bun run test:watch` | Run tests in watch mode    |

---

## Dependencies

| Package | Purpose                         |
| ------- | ------------------------------- |
| `zod`   | Runtime schema validation       |
| `ai`    | Vercel AI SDK — `tool()` helper |

---

## Testing

```bash
# From the monorepo root
bun run --filter @nightcode/shared test

# From this package
bun run test
```

Test coverage includes:

- `schemas.test.ts` — Tool schema validation
- `models.test.ts` — Model registry queries
- `keychain.test.ts` — Keychain manager operations
- `provider-keys.test.ts` — Provider resolution
- `task-graph.test.ts` — Graph creation, scheduling, cancellation, validation
