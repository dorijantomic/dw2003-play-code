#!/usr/bin/env bash
set -euo pipefail

server_url=http://127.0.0.1:8089
state_dir=/home/dorij/.local/state/ghidra-mcp
server_log=$state_dir/server.log
server_lock=$state_dir/start.lock
headless_launcher=/home/dorij/ddw3-walker/tools/ghidra-mcp-headless.sh
bridge=/home/dorij/.local/bin/bridge-mcp-ghidra

mkdir -p "$state_dir"

if ! curl --fail --silent --max-time 1 "$server_url/check_connection" >/dev/null; then
  (
    flock 9
    if ! curl --fail --silent --max-time 1 "$server_url/check_connection" >/dev/null; then
      nohup "$headless_launcher" >"$server_log" 2>&1 &
    fi
  ) 9>"$server_lock"

  for _attempt in $(seq 1 60); do
    if curl --fail --silent --max-time 1 "$server_url/check_connection" >/dev/null; then
      break
    fi
    sleep 1
  done
fi

if ! curl --fail --silent --max-time 2 "$server_url/check_connection" >/dev/null; then
  printf 'Ghidra MCP headless server did not become ready; see %s\n' "$server_log" >&2
  exit 1
fi

export GHIDRA_MCP_REQUIRE_PROGRAM_SELECTORS=1
exec "$bridge" "$@"
