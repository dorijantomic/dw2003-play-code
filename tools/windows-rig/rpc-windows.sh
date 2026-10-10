#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   tools/windows-rig/rpc-windows.sh setup-portable.lua
#   tools/windows-rig/rpc-windows.sh 'print(string.format("%08x", rd32(0x80055d2c)))'
#   tools/windows-rig/rpc-windows.sh rig-status
#   tools/windows-rig/rpc-windows.sh rig-kill
#
# rig-status and rig-kill exist because the mandated "kill pcsx-redux after
# every trace, including on failure paths" is otherwise unexecutable by the
# runtime researcher: its allowlist permits only this wrapper, and the in-band
# PCSX.quit() route works only while the emulator is healthy -- exactly the case
# where cleanup matters least. They never START the emulator; launching it stays
# a human action.

rig="${DW3_RIG_WIN_MOUNT:-/mnt/c/dw3-rig}"
rpc="$rig/rpc"
timeout="${2:-15}"
lock_timeout="${DW3_RIG_LOCK_TIMEOUT:-30}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lock="$repo/.dw3-research/windows-rig.lock"
sys32="${DW3_RIG_WIN_SYS32:-/mnt/c/Windows/System32}"
image="${DW3_RIG_IMAGE:-pcsx-redux.exe}"

mkdir -p "$rpc"
mkdir -p "$(dirname "$lock")"
if [[ -n "${DW3_RIG_LOCK_FD:-}" ]]; then
  # A bounded game experiment holds this same lock across its RPC and CUA
  # calls. Accept only an inherited descriptor referring to the actual lock.
  [[ "$DW3_RIG_LOCK_FD" =~ ^[0-9]+$ ]] &&
    [[ "/proc/$$/fd/$DW3_RIG_LOCK_FD" -ef "$lock" ]] || {
      echo "INVALID inherited rig lock" >&2; exit 1;
    }
  lock_fd="$DW3_RIG_LOCK_FD"
else
  exec 9>"$lock"
  lock_fd=9
fi
if ! flock -w "$lock_timeout" "$lock_fd"; then
  echo "RPC LOCK TIMEOUT after ${lock_timeout}s" >&2
  exit 1
fi

# Process-level rig control. Holds the same exclusive lock as an RPC call so it
# can never race a trace in flight.
case "${1:-}" in
  rig-status|rig-kill)
    if [[ ! -x "$sys32/tasklist.exe" ]]; then
      echo "RIG CONTROL UNAVAILABLE: $sys32/tasklist.exe not found" >&2
      exit 1
    fi
    listing="$("$sys32/tasklist.exe" /FI "IMAGENAME eq $image" /NH 2>/dev/null | tr -d '\r')"
    if ! grep -qi "$image" <<<"$listing"; then
      echo "RIG NOT RUNNING ($image)"
      exit 0
    fi
    echo "RIG RUNNING:"
    grep -i "$image" <<<"$listing"
    [[ "${1}" == "rig-status" ]] && exit 0

    # Graceful first: ask Redux to quit through the existing bridge.
    rm -f "$rpc/res.ready" "$rpc/res.txt"
    printf '%s\n' 'PCSX.quit()' > "$rpc/cmd.lua"
    touch "$rpc/cmd.ready"
    for _ in $(seq 1 50); do
      sleep 0.1
      grep -qi "$image" <<<"$("$sys32/tasklist.exe" /FI "IMAGENAME eq $image" /NH 2>/dev/null | tr -d '\r')" || {
        echo "RIG STOPPED (graceful PCSX.quit)"
        rm -f "$rpc/cmd.ready" "$rpc/cmd.lua"
        exit 0
      }
    done

    # Bridge is dead or wedged -- this is the case the graceful path cannot cover.
    "$sys32/taskkill.exe" /IM "$image" /F >/dev/null 2>&1 || true
    sleep 0.5
    if grep -qi "$image" <<<"$("$sys32/tasklist.exe" /FI "IMAGENAME eq $image" /NH 2>/dev/null | tr -d '\r')"; then
      echo "RIG KILL FAILED: $image still present" >&2
      exit 1
    fi
    echo "RIG STOPPED (forced taskkill; bridge was unresponsive)"
    rm -f "$rpc/cmd.ready" "$rpc/cmd.lua"
    exit 0
    ;;
esac

rm -f "$rpc/res.ready" "$rpc/res.txt"

if [[ -f "${1:-}" ]]; then
  cp "$1" "$rpc/cmd.lua"
else
  printf '%s\n' "${1:-}" > "$rpc/cmd.lua"
fi

# The Windows mount can refuse a create for a moment ("No such file or
# directory" on an existing folder; seen 2026-09-29 during an explorer run).
# Retrying is safe: the bridge runs nothing until cmd.ready exists.
for attempt in 1 2 3 4 5; do
  touch "$rpc/cmd.ready" 2>/dev/null && break
  [[ "$attempt" == 5 ]] && { touch "$rpc/cmd.ready"; exit 1; }
  sleep 0.2
done

for _ in $(seq 1 "$((timeout * 10))"); do
  if [[ -f "$rpc/res.ready" ]]; then
    cat "$rpc/res.txt"
    exit 0
  fi
  sleep 0.1
done

echo "RPC TIMEOUT"
exit 1
