#!/usr/bin/env bash
# What are the Grok Build runs doing, and where is the report?
#
# WHY THIS EXISTS. The delegate subagent hands its work to a background run and
# then returns "started in background as run-XXXX" -- which says nothing about
# whether the run ever started, finished, or produced anything. On 2026-08-27
# that cost two wasted round-trips and, worse, a completed 13KB report was
# declared "produced nothing" and the work redone by hand, because the only
# thing being watched was a transcript path that never fills in.
#
# The authority is the plugin's own job state, not the transcript:
#   ~/.claude/plugins/data/grok-build-*/state/<workspace>/jobs/run-*.json  (status)
#   ...............................................................*.log  (report)
#
# Usage:
#   tools/grok-runs.sh              list every run, newest last
#   tools/grok-runs.sh <run-id>     print that run's report
set -euo pipefail
ROOT=$(echo ~/.claude/plugins/data/grok-build-*/state/*/jobs)
[ -d "$ROOT" ] || { echo "no grok job state at $ROOT"; exit 1; }

if [ $# -ge 1 ]; then
  f="$ROOT/$1.log"
  [ -f "$f" ] || { echo "no log for run $1"; exit 1; }
  # The report is everything after the final-output marker.
  sed -n '/Final output/,$p' "$f"
  exit 0
fi

python3 - "$ROOT" <<'PY'
import json, sys, glob, os, datetime
root = sys.argv[1]
rows = []
for f in glob.glob(os.path.join(root, "*.json")):
    d = json.load(open(f))
    log = f[:-5] + ".log"
    size = os.path.getsize(log) if os.path.exists(log) else 0
    def t(k):
        v = d.get(k)
        if not v: return ""
        return datetime.datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone().strftime("%H:%M")
    rows.append((d.get("createdAt", ""), d.get("id", "?"), d.get("status", "?"),
                 d.get("phase", ""), t("createdAt"), t("completedAt"), size,
                 (d.get("summary") or "").replace("\n", " ")[:60]))
rows.sort()
print(f"{'run':24s} {'status':10s} {'phase':6s} {'start':5s} {'end':5s} {'bytes':>7s}  summary")
for _, rid, st, ph, c, e, size, summ in rows:
    flag = "" if st == "completed" else "  <-- NOT COMPLETE"
    print(f"{rid:24s} {st:10s} {ph:6s} {c:5s} {e:5s} {size:7d}  {summ}{flag}")
print("\nreport:  tools/grok-runs.sh <run-id>")
PY
