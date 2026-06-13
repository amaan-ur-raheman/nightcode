# ── Build stage ────────────────────────────────────────
FROM oven/bun:1.2 AS builder
WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json bun.lock* bunfig.toml* ./
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
RUN bun run build

# ── Production stage ──────────────────────────────────
FROM oven/bun:1.2-slim AS production
WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/database packages/database/
COPY --from=builder /app/packages/shared packages/shared/
COPY --from=builder /app/packages/server packages/server/
COPY --from=builder /app/packages/cli packages/cli/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock* ./

# Copy Prisma schema for runtime
COPY packages/database/prisma packages/database/prisma

ENV NODE_ENV=production
ENV BUN_ENV=production

EXPOSE 3001

CMD ["bun", "run", "packages/server/src/index.ts"]
