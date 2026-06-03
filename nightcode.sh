#!/bin/bash
set -e

NIGHTCODE_DIR="${NIGHTCODE_DIR:-/Users/amaan/Desktop/Programming/night-code}"
LOG="/tmp/nightcode-server.log"

# Parse -s <session-id> flag
SESSION_ID=""
if [ "$1" = "-s" ] && [ -n "$2" ]; then
    SESSION_ID="$2"
fi

# Kill any existing process on port 3000 (graceful then force)
PIDS=$(lsof -ti:3000 2>/dev/null) || true
if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -15 2>/dev/null || true
    sleep 1
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi

# Start server in background, suppress output
# Use --hot only in dev mode (NIGHTCODE_DEV=true)
bun run ${NIGHTCODE_DEV:+--hot} "$NIGHTCODE_DIR/packages/server/src/index.ts" >> "$LOG" 2>&1 &
SERVER_PID=$!

# Ensure server is killed on exit (Ctrl+C, errors, normal exit)
trap 'kill $SERVER_PID 2>/dev/null' EXIT

# Wait for server to be ready (up to 5s)
for i in $(seq 1 10); do
    (echo > /dev/tcp/localhost/3000) 2>/dev/null && break
    sleep 0.5
done

# Run CLI in foreground
NIGHTCODE_SESSION_ID="$SESSION_ID" bun run "$NIGHTCODE_DIR/packages/cli/src/index.tsx"

# Print goodbye screen
bun run "$NIGHTCODE_DIR/packages/cli/src/goodbye.ts"
