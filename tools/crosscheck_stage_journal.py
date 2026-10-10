#!/usr/bin/env python3
"""Compare browser-interpreter call journals against the BizHawk stage traces.

The rig dumps at /mnt/c/bizhawk-rig/dumps/stageNNN_entries.txt record, per armed
address, how many times its first instruction ran after the stage's own code was
confirmed resident. The journal from tools/stage_call_journal.ts records the same
ground truth from the browser interpreter. This tool cross-checks the executed
sets stage by stage and prints where they disagree.

    python3 tools/crosscheck_stage_journal.py --journal /tmp/opencode/journals.json
    python3 tools/crosscheck_stage_journal.py --journal ... --rig-only

Only stages whose rig trace has a resolvable ordinal-only gate are comparable;
the rest traced at whatever value the previous stage left.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gate_ordinal import gate_ordinal  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DUMPS = pathlib.Path("/mnt/c/bizhawk-rig/dumps")
ROW = re.compile(r"^([0-9a-f]{8}) after=(\d+) before=(\d+) (\S+)")


def stage_starts(stage: int) -> dict[int, str]:
    inv = json.loads((ROOT / "recovered/ddw3/function-inventory.json").read_text())
    sem = json.loads((ROOT / "recovered/ddw3/semantics.json").read_text())
    out: dict[int, str] = {}
    module_id = f"pro/wstag{stage}"
    for module in inv["modules"]:
        if module["id"] != module_id:
            continue
        for fn in [*module["functions"], *(module.get("pointer_candidates") or [])]:
            addr = int(str(fn.get("address") or fn.get("target_address") or "0"), 16)
            if addr:
                out[addr] = fn.get("semantic_name") or fn.get("original_name") or fn["id"]
    def parse(key: str) -> int:
        return int(key.partition(":")[2].replace("F0x", "0x"), 16)

    for key, fn in (sem.get("functions") or {}).items():
        if key.startswith(module_id + ":"):
            out[parse(key)] = fn["name"]
    for family in (sem.get("families") or {}).values():
        for key, name in (family.get("members") or {}).items():
            if key.startswith(module_id + ":"):
                out[parse(key)] = name
    return out


def rig_sets(path: pathlib.Path) -> tuple[int, set[int], int]:
    stage = 0
    ran: set[int] = set()
    frames = 0
    for line in path.read_text(encoding="utf8", errors="replace").splitlines():
        if line.startswith("# stage="):
            m = re.match(r"# stage=(\d+) .* frames=(\d+)", line)
            if m:
                stage = int(m.group(1))
                frames = int(m.group(2))
            continue
        m = ROW.match(line)
        if not m:
            continue
        if m.group(4) == "attributable" and int(m.group(2)) > 0:
            ran.add(int(m.group(1), 16))
    return stage, ran, frames


def gate_matched_hooks(stage: int, ordinal: int) -> dict[int, str]:
    """On-complete hooks of the events whose gate opens at this ordinal."""
    events = json.loads((ROOT / "web/assets/events/wstag_events.json").read_text())
    gates = json.loads((ROOT / "web/assets/data/auto_event_gates.json").read_text())
    names = stage_starts(stage)
    out: dict[int, str] = {}
    for event_id, row in (gates.get(f"s{stage}") or {}).items():
        conds = row["conds"]
        ord_ok = any(0x6000 <= f <= 0x60FF and f - 0x6000 == ordinal and v == 1 for f, v in conds)
        flags_ok = all(v == 0 for f, v in conds if not 0x6000 <= f <= 0x60FF)
        if not (ord_ok and flags_ok):
            continue
        for event in events.get(f"s{stage}", []):
            if event["id"] == int(event_id) and event.get("on_complete_fn_ram"):
                out[event["on_complete_fn_ram"]] = names.get(event["on_complete_fn_ram"], "?")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--journal", type=pathlib.Path, required=True)
    ap.add_argument("--dumps", type=pathlib.Path, default=DUMPS)
    ap.add_argument("--rig-only", action="store_true", help="only print mismatches")
    ap.add_argument("--with-hooks", action="store_true", help="count gate-matched event hooks as part of the journal side")
    args = ap.parse_args()

    journal = json.loads(args.journal.read_text())
    beats: dict[tuple[str, int], dict] = {}
    for row in journal["results"]:
        beats[(row["stage"], row["ordinal"])] = row

    comparable = 0
    agree = 0
    for dump in sorted(args.dumps.glob("stage*_entries.txt")):
        stage, rig_ran, rig_frames = rig_sets(dump)
        ordinal = gate_ordinal(stage)
        if ordinal is None:
            print(f"wstag{stage}: rig trace has no ordinal-only gate — not comparable")
            continue
        row = beats.get((f"s{stage}", ordinal))
        if row is None:
            swept = [o for (s, o) in beats if s == f"s{stage}"]
            if not swept:
                print(f"wstag{stage}: not built into the native manifest — journal cannot run it")
            else:
                print(f"wstag{stage}: no journal beat at ordinal {ordinal} (swept {swept}) — rerun")
            continue
        starts = stage_starts(stage)
        journal_ran = {e["pc"] for e in row["firstTouch"]}
        if args.with_hooks:
            journal_ran |= set(gate_matched_hooks(stage, ordinal))
        # The rig arms inventory entry addresses; compare only those.
        rig_mapped = {a: starts.get(a, "") for a in rig_ran}
        j_mapped = {a: starts.get(a, "") for a in journal_ran if a in starts}
        comparable += 1
        rig_only = sorted(set(rig_mapped) - set(j_mapped))
        journal_only = sorted(set(j_mapped) - set(rig_mapped))
        if not rig_only and not journal_only:
            agree += 1
            if not args.rig_only:
                print(
                    f"wstag{stage} @{ordinal}: {len(rig_mapped)} of {len(rig_mapped)} match "
                    f"(interpreter {row['frames']} frames, rig {rig_frames} frames)"
                )
            continue
        print(f"wstag{stage} @{ordinal}: MISMATCH")
        for a in rig_only:
            print(f"  rig only     {a:08x} {rig_mapped[a]}")
        for a in journal_only:
            print(f"  journal only {a:08x} {j_mapped[a]}")
    print(f"\n{agree}/{comparable} comparable stages agree exactly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
