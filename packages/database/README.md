# @nightcode/database

> Database layer for NightCode — Prisma ORM with PostgreSQL for session and message persistence.

---

## Overview

`@nightcode/database` provides the database client and schema for NightCode. It uses [Prisma](https://www.prisma.io) with the `@prisma/adapter-pg` driver adapter for PostgreSQL, storing sessions, messages, conversation branches, and user data.

---

## Features

- 🗄️ **PostgreSQL** — Robust relational database
- 🔒 **Prisma ORM** — Type-safe database queries
- 🌊 **Driver Adapter** — Uses `@prisma/adapter-pg` for direct `pg` driver support
- 📐 **Indexed Queries** — Optimized indexes for user + session lookups

---

## Project Structure

```
packages/database/
├── prisma/
│   └── schema.prisma         # Database schema definition
├── generated/
│   └── prisma/               # Auto-generated Prisma client (via db:generate)
├── src/
│   ├── index.ts              # Re-exports generated Prisma client types
│   ├── client.ts             # PrismaClient instance with pg adapter
│   └── __tests__/            # Database client tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Schema

### Session Model

```prisma
model Session {
    id             String   @id @default(cuid())
    userId         String
    title          String
    messages       Json     @default("[]")
    branches       Json     @default("[]")
    activeBranchId String   @default("main")
    createdAt      DateTime @default(now())
    updatedAt      DateTime @updatedAt

    @@index([userId, id])
    @@index([userId, createdAt])
}
```

| Field            | Type     | Description                                      |
| ---------------- | -------- | ------------------------------------------------ |
| `id`             | String   | Unique CUID                                      |
| `userId`         | String   | Owning user ID                                   |
| `title`          | String   | Session title (AI-generated or user-provided)    |
| `messages`       | JSON     | Array of messages with content, tool calls, etc. |
| `branches`       | JSON     | Conversation branch metadata                     |
| `activeBranchId` | String   | Currently active branch (default: `"main"`)      |
| `createdAt`      | DateTime | Creation timestamp                               |
| `updatedAt`      | DateTime | Last update timestamp                            |

**Indexes:**

- `[userId, id]` — Fast lookup of a specific session by user
- `[userId, createdAt]` — Fast listing of user sessions sorted by date

---

## Client Usage

```typescript
import { db } from '@nightcode/database/client';

// List sessions for a user
const sessions = await db.session.findMany({
    where: { userId: 'user_123' },
    orderBy: { createdAt: 'desc' },
});

// Create a new session
const session = await db.session.create({
    data: {
        userId: 'user_123',
        title: 'Refactor auth module',
        messages: [],
        branches: [],
    },
});

// Get a specific session
const one = await db.session.findUnique({
    where: { id: session.id },
});
```

### Exports

The package exports two entry points:

```typescript
// Prisma client types and enums
import { PrismaClient, Session } from '@nightcode/database';

// Database client instance
import { db } from '@nightcode/database/client';
```

---

## Scripts

| Command       | Description                                  |
| ------------- | -------------------------------------------- |
| `db:generate` | Generate Prisma client (`prisma generate`)   |
| `db:migrate`  | Run Prisma migrations (`prisma migrate dev`) |
| `test`        | Run tests with Vitest                        |
| `test:watch`  | Run tests in watch mode                      |

---

## Setup

```bash
# Generate the Prisma client (runs automatically on bun install via postinstall)
bun run db:generate

# Create and apply a migration
bun run db:migrate

# Push schema without migration (for prototyping)
bunx prisma db push
```

---

## Dependencies

| Package              | Purpose                      |
| -------------------- | ---------------------------- |
| `@prisma/client`     | Prisma ORM client            |
| `@prisma/adapter-pg` | PostgreSQL driver adapter    |
| `pg`                 | PostgreSQL client driver     |
| `dotenv`             | Environment variable loading |

### Dev Dependencies

| Package     | Purpose                     |
| ----------- | --------------------------- |
| `prisma`    | Prisma CLI and schema tools |
| `@types/pg` | TypeScript types for `pg`   |

---

## Environment Variables

| Variable       | Description                  |
| -------------- | ---------------------------- |
| `DATABASE_URL` | PostgreSQL connection string |

Example:

```
DATABASE_URL="postgresql://user:password@localhost:5432/nightcode?schema=public"
```
