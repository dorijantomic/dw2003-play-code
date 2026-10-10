#!/usr/bin/env bash
set -euo pipefail

# rig-watchdog.sh -- host-side deadline for bounded emulator probes.
#
# The in-emulator recorder cannot stop a stalled emulation by itself: the file
# bridge only processes commands on frame end, so a wedged emulator never runs
# cleanup. This wrapper owns the whole probe on the host: it arms the recorder
# through the same cmd.lua/cmd.ready/res.txt protocol as rpc-windows.sh, then
# polls the probe's completion artifact for this run's terminal record until
# --deadline, then validates the referenced sealed data artifact. Every
# result is bound to this run by a unique run id stamped into the arm
# command, the acknowledgement, the file header, the seal and the terminal
# record -- a previous run's output can never count as this run's completion,
# and a success record is only trusted after the complete sealed artifact
# it references is on disk.
#
# It NEVER starts the emulator (launch stays a human action) and it NEVER
# stops it unless --owned is passed by the session owner. Without --owned a
# stall prints the exact recovery commands and leaves the session untouched.
#
# Usage:
#   tools/windows-rig/rig-watchdog.sh \
#     --out-wsl /mnt/c/dw3-rig/dumps/cardgame_callgraph.txt \
#     --deadline 90 --arm-timeout 30 --owned \
#     -- tools/windows-rig/trace-cardgame-callgraph.lua
#
# The argument after -- is a Lua file path or a one-line Lua snippet. The
# watchdog speaks the bridge directly (it already holds the rig lock) and
# prepends a unique CG_RUN assignment, so the recorder can echo it.
#
# Exit codes: 0 run ended status=ok with its sealed artifact verified; 1
# usage/lock error; 2 arm failure (bridge timeout OR bridge/arm error --
# the probe never started); 3 capture stall (no terminal record by the
# deadline); 4 run ended status=failed, or status=ok whose sealed artifact
# is missing/torn (the terminal names its reason). A timeout stays a
# timeout even when the owned stop succeeds: the stop outcome is reported,
# then the phase's code is returned.

usage() {
  sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
  exit 1
}

deadline=90
arm_timeout=30
acquire_timeout="${DW3_RIG_LOCK_TIMEOUT:-30}"
owned=0
out_wsl=""
rig="${DW3_RIG_WIN_MOUNT:-/mnt/c/dw3-rig}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deadline) deadline="$2"; shift 2 ;;
    --arm-timeout) arm_timeout="$2"; shift 2 ;;
    --acquire-timeout) acquire_timeout="$2"; shift 2 ;;
    --out-wsl) out_wsl="$2"; shift 2 ;;
    --owned) owned=1; shift ;;
    --rig) rig="$2"; shift 2 ;;
    --help|-h) usage ;;
    --) shift; break ;;
    *) echo "unknown flag: $1" >&2; usage ;;
  esac
done

[[ -n "$out_wsl" ]] || { echo "missing --out-wsl" >&2; usage; }
[[ $# -ge 1 ]] || { echo "missing arm command after --" >&2; usage; }
[[ "$deadline" =~ ^[0-9]+$ && "$arm_timeout" =~ ^[0-9]+$ ]] \
  || { echo "--deadline/--arm-timeout must be integer seconds" >&2; exit 1; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lock="$repo/.dw3-research/windows-rig.lock"
rpc="$rig/rpc"
run="$(date +%s)-$$"

mkdir -p "$rpc" "$(dirname "$lock")"
exec 9>"$lock"
if ! flock -w "$acquire_timeout" 9; then
  echo "WATCHDOG LOCK TIMEOUT after ${acquire_timeout}s (another rig op owns $lock)" >&2
  exit 1
fi
# Lock held from here until release_lock. A stale arm request must never sit
# in the bridge where a later session could execute it.
release_lock() { exec 9>&-; }
cleanup_cmd() { rm -f "$rpc/cmd.ready" "$rpc/cmd.lua"; }
trap cleanup_cmd EXIT

# Timeout in either phase: report freshness evidence, then stop only an
# owned session. The stop outcome is reported but never replaces the
# phase's exit code.
on_timeout() {
  local phase="$1" code="$2" detail="$3"
  echo "WATCHDOG ${phase}-TIMEOUT: ${detail}" >&2
  for f in "$out_wsl" "$out_wsl.done"; do
    if [[ -f "$f" ]]; then
      local mtime now
      mtime=$(stat -c %Y "$f"); now=$(date +%s)
      echo "present: $f size=$(stat -c %s "$f") bytes, last write $((now - mtime))s ago" >&2
      echo "last line: $(tail -n 1 "$f")" >&2
    else
      echo "absent: $f" >&2
    fi
  done
  if [[ "$owned" -eq 0 ]]; then
    echo "NOT OWNED: leaving the session untouched. Owner recovery:" >&2
    echo "  tools/windows-rig/bizhawk-rpc rig-status" >&2
    echo "  tools/windows-rig/bizhawk-rpc rig-kill   # only for a session you own" >&2
    exit "$code"
  fi
  echo "OWNED: attempting stop (releasing probe lock first so rig-kill can take it)"
  release_lock
  trap - EXIT
  cleanup_cmd
  # Forward the selected target identity: the delegate otherwise re-selects
  # its bridge from the ambient environment.
  local kill_out kill_code
  kill_code=0
  kill_out="$(DW3_RIG_WIN_MOUNT="$rig" "$repo/tools/windows-rig/rpc-windows.sh" rig-kill 2>&1)" || kill_code=$?
  echo "stop result (exit=$kill_code): $kill_out"
  exit "$code"
}

# --- Phase 1: arm -----------------------------------------------------------
rm -f "$rpc/res.ready" "$rpc/res.txt"
{
  printf 'CG_RUN="%s"\n' "$run"
  if [[ -f "$1" ]]; then cat "$1"; else printf '%s\n' "$1"; fi
} > "$rpc/cmd.lua"
touch "$rpc/cmd.ready"

t0=$(date +%s)
armed=""
while (( $(date +%s) - t0 < arm_timeout )); do
  if [[ -f "$rpc/res.ready" ]]; then
    armed="$(cat "$rpc/res.txt" 2>/dev/null || true)"
    rm -f "$rpc/res.ready" "$rpc/res.txt"
    break
  fi
  sleep 0.5
done

if [[ -z "$armed" ]]; then
  on_timeout ARM 2 "no bridge result after ${arm_timeout}s (no frame end) run=$run"
fi
# Bridge contract (bridge-portable.lua): a failed command answers ERROR: ...
if [[ "$armed" == ERROR* ]]; then
  echo "WATCHDOG ARM-ERROR, probe never started (run=$run): $armed" >&2
  if [[ "$owned" -eq 1 ]]; then
    echo "OWNED: bridge answered but the arm command failed; attempting stop" >&2
    on_timeout ARM 2 "arm command failed run=$run"
  fi
  exit 2
fi
if ! grep -qF "run=$run" <<<"$armed"; then
  echo "WATCHDOG ARM-UNMATCHED, probe never started (run=$run): $armed" >&2
  exit 2
fi
echo "WATCHDOG ARMED (run=$run): $armed"

# --- Phase 2: bounded wait for this run's completion artifact ---------------
# The terminal lives in <output>.done, published after the sealed data
# artifact. Trusting the terminal alone would reintroduce the success-
# before-write failure: a torn data write with a surviving terminal must
# stay a failure, so status=ok additionally requires the matching seal.
done_wsl="$out_wsl.done"
terminal="# terminal run=$run"
seal="# seal run=$run complete"
t1=$(date +%s)
while (( $(date +%s) - t1 < deadline )); do
  if [[ -f "$done_wsl" ]] && grep -qF "$terminal" "$done_wsl" 2>/dev/null; then
    wall=$(($(date +%s) - t1))
    line="$(grep -F "$terminal" "$done_wsl" 2>/dev/null | tail -n 1 || true)"
    echo "WATCHDOG TERMINAL after ${wall}s: $line"
    if ! grep -qF "$terminal status=ok" <<<"$line"; then
      exit 4
    fi
    if [[ -f "$out_wsl" ]] && grep -qF "$seal" "$out_wsl" 2>/dev/null; then
      exit 0
    fi
    echo "WATCHDOG ARTIFACT-TORN: terminal claims ok but the sealed data is missing: $out_wsl" >&2
    exit 4
  fi
  sleep 1
done

on_timeout CAPTURE 3 "no terminal record for run=$run after ${deadline}s"
