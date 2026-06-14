#!/bin/bash
set -e

NIGHTCODE_DIR="${NIGHTCODE_DIR:-/Users/amaan/Desktop/Programming/night-code}"
LOG="/tmp/nightcode-server-$(id -u).log"
PORT=5959
PID_FILE="/tmp/nightcode-server-$(id -u).pid"
export PID_FILE
SESSION_DIR="/tmp"

# ─── Helpers ────────────────────────────────────────────────────────────────

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

is_server_running() {
    # Check PID file first
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        # Stale PID file — server is dead
        rm -f "$PID_FILE"
    fi
    # Fallback: check if anything is listening on the port and is actually the nightcode server
    local port_pids
    port_pids=$(lsof -ti:"$PORT" 2>/dev/null) || true
    if [ -n "$port_pids" ]; then
        for pid in $port_pids; do
            if ps -p "$pid" -o command= 2>/dev/null | grep -q "packages/server/src/index.ts"; then
                # Re-create PID file for consistency
                echo "$pid" > "$PID_FILE"
                return 0
            fi
        done
    fi
    return 1
}

cleanup_stale_sessions() {
    for f in "$SESSION_DIR"/nightcode-session-$(id -u)-*; do
        [ -e "$f" ] || continue
        local pid
        pid=$(basename "$f" | sed "s/nightcode-session-$(id -u)-//")
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$f"
        fi
    done
}

active_sessions_count() {
    local count=0
    for f in "$SESSION_DIR"/nightcode-session-$(id -u)-*; do
        [ -e "$f" ] || continue
        local pid
        pid=$(basename "$f" | sed "s/nightcode-session-$(id -u)-//")
        if kill -0 "$pid" 2>/dev/null; then
            count=$((count + 1))
        fi
    done
    echo "$count"
}

cleanup_session() {
    rm -f "$SESSION_DIR/nightcode-session-$(id -u)-$$"
    # If we started the server and no sessions remain, shut it down
    if [ "$I_STARTED_SERVER" = true ] && [ "$(active_sessions_count)" -eq 0 ]; then
        if [ -n "$SERVER_PID" ]; then
            kill "$SERVER_PID" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi
}

# ─── Parse args ─────────────────────────────────────────────────────────────

SESSION_ID=""
if [ "$1" = "-s" ] && [ -n "$2" ]; then
    SESSION_ID="$2"
fi

# ─── Session lifecycle ─────────────────────────────────────────────────────

# Clean up stale session files from crashed processes
cleanup_stale_sessions

# Start server if not already running
I_STARTED_SERVER=false
if is_server_running; then
    SERVER_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -z "$SERVER_PID" ]; then
        # Fallback/retry: find the PID of the process actually running nightcode server on the port
        SERVER_PID=$(lsof -ti:"$PORT" 2>/dev/null | while read -r pid; do
            if ps -p "$pid" -o command= 2>/dev/null | grep -q "packages/server/src/index.ts"; then
                echo "$pid"
                break
            fi
        done)
    fi
else
    # Use --hot only in dev mode (NIGHTCODE_DEV=true)
    bun run ${NIGHTCODE_DEV:+--hot} --env-file="$NIGHTCODE_DIR/.env" "$NIGHTCODE_DIR/packages/server/src/index.ts" >> "$LOG" 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PID_FILE"
    I_STARTED_SERVER=true
fi

# Ensure cleanup on exit (Ctrl+C, errors, normal exit)
trap 'cleanup_session' EXIT

# Wait for server to be ready (up to 5s)
wait_for_server "$PORT"

# Register this session
echo "$$" > "$SESSION_DIR/nightcode-session-$(id -u)-$$"

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
