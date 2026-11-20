#!/bin/bash
# tools/rewrite/check.sh [scenario ...]
# Records every scenario on the OLD game (~/dw2003-play-integration, port 8191) and the
# worktree (~/dw2003-rewrite, port 8192) with the same seed, and prints same/different per
# scenario. Old game is read only. Set OLD_ONCE=1 to reuse an existing old recording
# (OLD_ONCE= , i.e. empty, re-records both sides fresh).
# MUTATE="web/x.js|old text|new text" changes the served text in memory only (no file touched),
# used to prove the net catches a break. Recordings: /mnt/c/Users/dorij/scratch/rewrite-2026-11-18/recordings/
export PATH=~/.nvm/versions/node/v24.16.0/bin:$PATH
NEW=${NEW_REPO:-$HOME/dw2003-rewrite}
OLD=${OLD_REPO:-$HOME/dw2003-play-integration}
R=${REC_DIR:-/mnt/c/Users/dorij/scratch/rewrite-2026-11-18/recordings}
SEED=${SEED:-1}
OLD_PORT=${OLD_PORT:-8191}
NEW_PORT=${NEW_PORT:-8192}
# Several agents at once: one run at a time per machine (flock on a shared lock file, waits up to
# 20 min); servers bind 127.0.0.1 only for the run. Set CHECK_NOLOCK=1 to skip, or use
# OLD_PORT/NEW_PORT/REC_DIR to run in parallel on your own ports and folder.
if [ -z "$CHECK_NOLOCK" ] && [ -z "$CHECK_LOCKED" ]; then
  export CHECK_LOCKED=1
  exec flock -w 1200 /tmp/rewrite-check.lock "$0" "$@"
fi
SCEN=${@:-field battle menu shop save}
mkdir -p "$R"
cd "$NEW" || exit 2
status=0
for s in $SCEN; do
  if [ -z "$OLD_ONCE" ] || [ ! -f "$R/old-$s-$SEED.jsonl" ]; then
    tools/run-playwright.sh tools/rewrite/record.mjs --repo "$OLD" --port $OLD_PORT --scenario $s --seed $SEED --out "$R/old-$s-$SEED.jsonl" > "$R/log-$s.txt" 2>&1 || { echo "$s: RECORDING FAILED (see $R/log-$s.txt)"; status=1; continue; }
  fi
  rm -f "$R/new-$s-$SEED.jsonl"
  tools/run-playwright.sh tools/rewrite/record.mjs --repo "$NEW" --port $NEW_PORT ${MUTATE:+--mutate "$MUTATE"} --scenario $s --seed $SEED --out "$R/new-$s-$SEED.jsonl" > "$R/log-$s.txt" 2>&1 || { echo "$s: RECORDING FAILED (see $R/log-$s.txt)"; status=1; continue; }
  grep -h renderer "$R/log-$s.txt" | head -1
  if res=$(node tools/rewrite/compare.mjs "$R/old-$s-$SEED.jsonl" "$R/new-$s-$SEED.jsonl" 2>&1); then echo "$s: SAME  $res"; else echo "$s: DIFFERENT  $res"; echo "  files: $R/old-$s-$SEED.jsonl $R/new-$s-$SEED.jsonl   run log: $R/log-$s.txt"; status=1; fi
done
exit $status
