#!/usr/bin/env bash
# Warp into stage overlays with the developers' own launcher and count which
# functions actually execute, one trace per stage.
#
# The warp is two writes into the resident object at 0x80048d34 -- exactly what
# the stage-select screen's row handler does through the screen launcher stored
# at 0x8004b440 (exe-decomp/c/F0x80016b88.c:4-5). The launcher only parks the
# request; the game's own loop consumes it, which is why both words read back 0
# once the transition has happened. Launch codes come from the developers' own
# destination table, not from the stage number: web/assets/data/stagslct_ui.json
# maps stage -> code (s780 -> 0x2d7, s740 -> 0x26b, ...).
#
# Usage:
#   tools/stage_entry_sweep.sh 780 740 310
#   STAGES=780 WALK=20 tools/stage_entry_sweep.sh
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc="$repo/tools/windows-rig/bizhawk-rpc"
rigwin="${DW3_RIG_WIN_MOUNT:-/mnt/c/bizhawk-rig}"
stages="${*:-${STAGES:-}}"
walk="${WALK:-12}"
[[ -z "$stages" ]] && { echo "usage: $0 <stage> [stage...]" >&2; exit 2; }
[[ -x "$rigwin" || -d "$rigwin" ]] || { echo "rig mount $rigwin missing" >&2; exit 1; }

call() { timeout 90 "$rpc" "$@" 2>&1 | tail -n 3; }

# A field scene is usable only when a live actor table is present and no warp
# request is still pending. Both conditions matter: the pending flag was the only
# warning that the game had already stopped consuming requests, and issuing
# another write into that state left the emulated game hung with the field torn
# down and no screen loaded.
healthy() {
  call 'print(string.format("HEALTHY=%d req=0x%x objs=0x%x scene=0x%x",
      (rd32(0x8004b3fc)==0 and rd32(0x8004b610)~=0 and getSceneID()~=0xffffffff) and 1 or 0,
      rd32(0x8004b3fc), rd32(0x8004b610), getSceneID()))' | grep -o "HEALTHY=[01]"
}

# Warp and wait for it to land. On timeout the state is reloaded and the caller
# is told to skip the stage, so one bad code cannot poison the rest of a sweep.
warp_to() {
  local code="$1"
  [[ "$(healthy)" == "HEALTHY=1" ]] || { echo "  UNHEALTHY before warp -- refusing to write"; return 1; }
  call "wr32(0x8004b3fc,$code); wr32(0x8004b404,0)" >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 2
    [[ "$(healthy)" == "HEALTHY=1" ]] && { echo "  warp landed"; return 0; }
  done
  echo "  HUNG: request not consumed; reloading the known-good state"
  call "savestate.load(\"$rigwin/bizhawk-active/PSX/State/Digimon World 2003 (Europe) (En,Fr,De,Es,It).Octoshock.QuickSave1.State\")" >/dev/null
  sleep 3
  return 1
}

# Hand the tracer its address list (must land where the emulator can dofile it).
cd "$repo"
.venv/bin/python3 tools/build_stage_entry_list.py \
  --stages "$(echo "$stages" | tr ' ' ',')" --out "$rigwin/fnlist.lua"

# The emulator dofiles these from C:/bizhawk-rig/, not from the repo, so a stale
# copy there silently runs an old tracer. Keep them in step.
cp "$repo/tools/windows-rig/trace-stage-entries.lua" \
   "$repo/tools/windows-rig/collect-stage-entries.lua" "$rigwin/"

for stage in $stages; do
  code="$(.venv/bin/python3 - "$stage" <<'PY'
import json,sys
want=int(sys.argv[1])
d=json.load(open('web/assets/data/stagslct_ui.json'))
row=next((x for x in d['destinations'] if x['stage']==want and x.get('kind')=='screen'), None)
print(row['type'] if row else '')
PY
)"
  if [[ -z "$code" ]]; then
    echo "stage $stage: no launch code in the developers' destination table -- skipped" >&2
    continue
  fi

  # Read the stage's own gate value. A gate is satisfiable from the ordinal alone
  # when its conditions are the ordinal plus stored flags whose expected value is
  # 0 -- unset is already the field's state. A gate needing a flag set to 1 is
  # skipped loudly rather than faked, because the event it drives would not be the
  # event a player meets.
  ordinal="$(.venv/bin/python3 tools/gate_ordinal.py "$stage")"
  echo "=== wstag$stage (launch code $code, gate ordinal ${ordinal:-none}) ==="
  # The write happens after the warp lands, not before: a stage's own entry hook
  # can overwrite the story word (s780's "opening ordinal reset" sets it back), so
  # a value written before arrival belongs to the previous stage's context.
  gate_write() {
    [[ -z "$ordinal" ]] && return 0
    call "wr32(0x8004b370,$ordinal)" >/dev/null
  }
  if [[ -z "$ordinal" ]]; then
    echo "  no ordinal-only gate for this stage; tracing at the current story word" >&2
  fi
  # Agent mode is set by the operator's request for a controlled run; the guard
  # in player-control.lua refuses every write until then.
  call 'rig_control("agent")' >/dev/null
  # Arm before the transition. A stage's constructors and spawners run while its
  # overlay loads, which is finished long before any host-side poll could notice;
  # arming afterwards is what capped the yield at the per-frame draw routines.
  # The collector splits hits at the frame the target overlay becomes resident,
  # so arming early cannot misattribute the previous stage's code.
  call "DW3_STAGE=$stage; dofile('C:/bizhawk-rig/trace-stage-entries.lua')" 2>/dev/null | sed 's/^/  /'
  # Written before the warp so the arriving load's event dispatcher sees the right
  # beat. A stage's own entry hook may overwrite it (s780 resets the story word),
  # so it is written again on arrival and the screen re-entered once, which is the
  # load that actually dispatches the gated event.
  gate_write
  if ! warp_to "$code"; then
    # Disarm what the abandoned warp left armed before moving to the next stage.
    call "dofile('C:/bizhawk-rig/collect-stage-entries.lua')" >/dev/null 2>&1
    continue
  fi
  gate_write
  warp_to "$code" >/dev/null
  # The landed scene goes to the collector as the taint baseline: the target's
  # code can be in RAM while the scene word still shows the previous stage, and
  # comparing against that old value would mark every fast load as a taint.
  arrival="$(call 'print(string.format("at scene=0x%x ordinal=%d objs=0x%x", getSceneID(), rd32(0x8004b370), rd32(0x8004b610)))')"
  printf '%s\n' "$arrival" | sed 's/^/  /'
  landed="$(printf '%s' "$arrival" | grep -o 'scene=0x[0-9a-f]*' | head -n 1 | cut -d= -f2)"

  # One queued walk. press() appends to the interface's pressQueue, which drains
  # on frame end, so a single call can drive a whole route -- polling four short
  # presses separately starves emulation behind RPC latency and barely moves.
  #
  # Random encounters would change the scene and taint the trace, so the step
  # counter at 0x80048d64 is held high: the encounter driver only rolls when it
  # decrements to <=0 (docs/research/field/
  # encounter-step-counter-decoded-2026-07-25.md sec 2). Holding the counter
  # leaves the type-4 zone map registered, so scripted area triggers that read
  # the same zone data still fire.
  beat=$(( walk * 6 ))
  call "wr32(0x80048d64,0x7ffffff)
press(BTN.RIGHT,$beat); press(BTN.UP,$((beat/2))); press(BTN.LEFT,$beat); press(BTN.DOWN,$((beat/2)))
print('walk queued='..$beat)"
  deadline=$((SECONDS + walk + 6))
  while (( SECONDS < deadline )); do
    sleep 5
    call 'wr32(0x80048d64,0x7ffffff); print("counter held, frame="..emu.framecount())' >/dev/null
  done

  collect_out="$(call "DW3_SCENE=${landed:-nil}; dofile('C:/bizhawk-rig/collect-stage-entries.lua')" 2>/dev/null)"
  printf '%s\n' "$collect_out" | sed 's/^/  /'
  if [[ "$collect_out" == *COLLECTED* ]]; then
    [[ -f "$rigwin/dumps/stage${stage}_entries.txt" ]] && sed -n '1p;$p' "$rigwin/dumps/stage${stage}_entries.txt" | sed 's/^/  /'
  else
    echo "  trace did not arm -- no dump written for this stage"
  fi
done

call 'rig_control("human"); rig_player_status()' 2>/dev/null | sed 's/^/  /'
