#!/bin/bash
set -e

NIGHTCODE_DIR="${NIGHTCODE_DIR:-/Users/amaan/Desktop/Programming/night-code}"
LOG="/tmp/nightcode-server.log"

kill_port_processes() {
    local port=$1
    local PIDS
    PIDS=$(lsof -ti:"$port" 2>/dev/null) || true
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -15 2>/dev/null || true
        sleep 1
        echo "$PIDS" | xargs kill -9 2>/dev/null || true
    fi
}

wait_for_server() {
    local port=$1
    for i in $(seq 1 10); do
        (echo > /dev/tcp/localhost/$port) 2>/dev/null && break
        sleep 0.5
    done
}

# Parse -s <session-id> flag
SESSION_ID=""
if [ "$1" = "-s" ] && [ -n "$2" ]; then
    SESSION_ID="$2"
fi

# Kill any existing process on port 3000 (graceful then force)
kill_port_processes 3000

# Start server in background, suppress output
# Use --hot only in dev mode (NIGHTCODE_DEV=true)
bun run ${NIGHTCODE_DEV:+--hot} --env-file="$NIGHTCODE_DIR/.env" "$NIGHTCODE_DIR/packages/server/src/index.ts" >> "$LOG" 2>&1 &
SERVER_PID=$!

# Ensure server is killed on exit (Ctrl+C, errors, normal exit)
trap 'kill $SERVER_PID 2>/dev/null' EXIT

# Wait for server to be ready (up to 5s)
wait_for_server 3000

# Run CLI in foreground (forward all arguments)
NIGHTCODE_SESSION_ID="$SESSION_ID" bun run --env-file="$NIGHTCODE_DIR/.env" "$NIGHTCODE_DIR/packages/cli/src/index.tsx" "$@"
CLI_EXIT=$?

# Only show goodbye screen for interactive TUI sessions
if [ $CLI_EXIT -eq 0 ]; then
    # Skip goodbye for non-TUI commands
    case "$1" in
        --non-interactive|-n|mcp|init|--help|-h)
            ;;
        *)
            bun run --env-file="$NIGHTCODE_DIR/.env" "$NIGHTCODE_DIR/packages/cli/src/goodbye.ts"
            ;;
    esac
fi
