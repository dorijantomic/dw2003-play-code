#!/usr/bin/env python3
"""Extract the START GATE of a stage's LATER story beat from its wstag overlay
-> web/assets/data/beat_event_gates.json.

Why this is needed. tools/extract_auto_event_gates.py recovers the stage-entry
dispatcher's guard for every `jal start_event` it can trace from the FUNCTION
ENTRY, and it only accepts an event whose `start_event` is reached by exactly
ONE constraint set containing exactly one ordinal equality. On the five stages
that carry TWO story beats in one room (s212, s305, s520, s620, s750) the beat's
CLOSING event is started from the SAME dispatcher function but only after the
dispatcher has RE-READ the master ordinal, so:

  * the entry-trace sees two ordinal equalities on one path (ord==m at the top,
    ord==n at the tail) and calls the path infeasible -> no gate at all
    (s620: event 551), or
  * the dispatcher has several if-blocks that all funnel into one shared
    `start_event`, so the entry-trace sees a combinatorial set of paths
    (s750: event 886).

Result before this tool: those closing events carried NO gate, so the browser
played the later beat's fight + closing scene on the FIRST visit, and the
master story step was stored a whole beat too early (s620 event 551 stores 0x15;
s750 event 886 stores 0x21; s305 event 893 stores 0x22).

Method (still no emulator, no RAM):
  1. Take the beat owners from web/assets/data/ordinal_owner.json (which event's
     on_complete routine writes which ordinal) crossed with
     web/assets/data/progress_ordinal.json, and keep only the owners of a stage's
     LATER ordinals -- i.e. exactly the events that close a second beat.
  2. Find the `jal 0x800853f8` (start_event) whose $a0 is that event id.
  3. The gate is read from the TAIL of the dispatcher: the nearest preceding
     `lw $vX,-0x4c90($v0)` (a re-read of [0x8004b370]) that can still reach that
     call carrying that event id in $a0. Everything the chain tests between that
     load and the call -- ordinal equality and every get_flag expectation -- is
     the gate.

Why the tail is the right slice: the dispatcher is re-entered every time the
stage is entered or re-checked, and each entry RE-READS the live master ordinal
(wstag620.s .L0x430 vs .L0x4cc; wstag305.s .L0x41c/.L0x46c/.L0x4d4), so only the
LAST read binds the current decision -- the flags tested above it belong to the
earlier ordinal's regime and are not required on this one. The emitted gate is
therefore a NECESSARY condition (an over-approximation of "the original starts
this event"), never a fabricated one: every leaf is a branch the chain really
tests, and an event whose tail chain does not agree on one ordinal equality is
left ungated and listed in `unresolved`.

Output: { stage: { event_id: { conds: [[flagId, expected], ...], ordinal: N } } }
        ordinal equality is the virtual ordinal bank: flagId = 0x6000|N, exp 1.

Run: python3 tools/extract_beat_event_gates.py
"""
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
OUT = ROOT / "web/assets/data/beat_event_gates.json"
LADDER = ROOT / "web/assets/data/progress_ordinal.json"
OWNER = ROOT / "web/assets/data/ordinal_owner.json"
ENTRY_GATES = ROOT / "web/assets/data/auto_event_gates.json"
WSTAG_EVENTS = ROOT / "web/assets/events/wstag_events.json"

_spec = importlib.util.spec_from_file_location(
    "auto_gates", Path(__file__).resolve().parent / "extract_auto_event_gates.py")
AG = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(AG)

MAX_ORDINAL_GUARD = 0x200      # an ordinal compare is `li $vX,imm`; imm < 0x200 is a beat


def ordinal_load(ws, i):
    """True if word i re-reads the master story ordinal [0x8004b370]."""
    d = AG.decode(ws[i])
    return d[0] == "lw" and d[3] == -0x4C90


def trace_tail(ws, entry, end, call_idx, want_ev):
    """Constraint sets on paths entry->call_idx that arrive with $a0 == want_ev.

    Same abstract machine as extract_auto_event_gates.trace_call (register
    tracking, get_flag detection, delay-slot argument handling), but it starts at
    one chosen instruction instead of the function entry and only records paths
    that reach `call_idx` with the wanted event id in $a0.
    """
    results, npaths = [], [0]

    def run(idx, regs, a0, a1, guards, visited):
        while True:
            if npaths[0] > AG.MAX_PATHS or idx < entry or idx >= end or idx in visited:
                return
            visited = visited | {idx}
            w = ws[idx]
            d = AG.decode(w)
            k = d[0]

            if k == "start_event":
                if idx == call_idx:
                    a0d, _ = AG.apply_args(ws[idx + 1], regs, a0, a1)
                    if a0d and a0d[0] == "imm" and a0d[1] == want_ev:
                        results.append(list(guards))
                        npaths[0] += 1
                return

            if k in ("beq", "bne"):
                target = idx + 1 + d[3]
                a0d, a1d = AG.apply_args(ws[idx + 1], regs, a0, a1)
                regs2 = dict(regs)
                AG.apply_regs(ws[idx + 1], regs2)
                ra, rb = regs.get(d[1]), regs.get(d[2])
                if ra and ra[0] == "ordinal" and rb and rb[0] == "ordinal":
                    if k == "beq":
                        run(target, dict(regs2), a0d, a1d, list(guards), visited)
                        return
                    idx, regs, a0, a1 = idx + 2, regs2, a0d, a1d
                    continue
                gt, gf = AG.branch_constraint(d, regs)
                if AG.feasible(guards, gt):
                    run(target, dict(regs2), a0d, a1d, guards + ([gt] if gt else []), visited)
                if not AG.feasible(guards, gf):
                    return
                idx, regs, a0, a1, guards = idx + 2, regs2, a0d, a1d, guards + ([gf] if gf else [])
                continue

            if k == "jalr":
                tag = regs.get(d[1])
                a0d, a1d = AG.apply_args(ws[idx + 1], regs, a0, a1)
                regs2 = dict(regs)
                AG.apply_regs(ws[idx + 1], regs2)
                if tag == ("fnptr_getflag",) and a0d and a0d[0] == "imm" and a1d and a1d[0] == "imm":
                    regs2[2] = ("getflag", a0d[1], a1d[1])
                else:
                    regs2[2] = regs2[3] = None
                idx, regs, a0, a1 = idx + 2, regs2, a0d, a1d
                continue

            if k == "jal":
                a0d, a1d = AG.apply_args(ws[idx + 1], regs, a0, a1)
                regs2 = dict(regs)
                AG.apply_regs(ws[idx + 1], regs2)
                regs2[2] = regs2[3] = None
                idx, regs, a0, a1 = idx + 2, regs2, a0d, a1d
                continue

            if k == "jr":
                return

            a0, a1 = AG.apply_args(w, regs, a0, a1)
            AG.apply_regs(w, regs)
            idx += 1

    run(entry, {}, None, None, [], frozenset())
    return results


def gate_of(stage, ev_id, skip):
    """{conds, ordinal} for one event, or (None, reason)."""
    path = ASM_DIR / f"wstag{stage}.s"
    if not path.exists():
        return None, "no wstag overlay in asm/dw2003/pro"
    ws = AG.words_of(path)
    funcs = AG.find_functions(ws)
    # Every start_event call in the overlay is a candidate: which one carries this event id in
    # $a0 is decided by the trace (a branch delay slot far above the call can be the loader, so
    # a textual "is the id loaded just before the call" pre-filter would miss it).
    sites = [i for i, w in enumerate(ws) if w == AG.JAL_START_EVENT]
    if not sites:
        return None, "overlay has no start_event call at all"
    fn = next((f for f in funcs if f[0] <= sites[0] < f[1]), None)
    if not fn:
        return None, "call site is outside every function the jr $ra splitter found"
    for call in sites:
        if not (fn[0] <= call < fn[1]):
            continue
        # Nearest-first: the last ordinal re-read that can still reach THIS call
        # with THIS event id is the slice that governs the decision.
        loads = [i for i in range(max(fn[0], call - 256), call) if ordinal_load(ws, i)]
        for entry in reversed(loads):
            paths = trace_tail(ws, entry, fn[1], call, ev_id)
            if not paths:
                continue
            distinct = {frozenset(p) for p in paths}
            if len(distinct) != 1:
                continue                      # paths disagree -> not proven
            conds = sorted(distinct.pop(),
                           key=lambda c: (0 if (c[0] & 0xFF00) == 0x6000 else 1, c[0], c[1]))
            pos = {c[0] & 0xFF for c in conds if (c[0] & 0xFF00) == 0x6000 and c[1] == 1}
            if len(pos) != 1:
                continue                      # no single beat on every path
            n = pos.pop()
            if n >= MAX_ORDINAL_GUARD:
                continue
            drop = {c[0] for c in conds if (c[0] & 0xFF00) == 0x6000 and c[1] == 0}
            conds = [c for c in conds if c[0] not in drop or (c[0] & 0xFF00) != 0x6000]
            return {"conds": [[c[0], c[1]] for c in conds], "ordinal": n,
                    "slice": f"wstag{stage}.s @0x{entry * 4:x}-0x{call * 4:x}"}, None
    return None, "no ordinal-anchored tail slice reaches the call with this event id"



def main():
    ladder = json.loads(LADDER.read_text())
    owner = json.loads(OWNER.read_text())
    entry_gates = json.loads(ENTRY_GATES.read_text())
    evs = json.loads(WSTAG_EVENTS.read_text())

    out, unresolved = {}, []
    for row in owner["ladder"]:
        stage, ords = row["stage"], row["ordinals"]
        if len(ords) < 2:
            continue                                     # single-beat stage: entry gate is enough
        later = set(ords[1:])
        targets = [(int(eid), o) for eid, o in row["owner"].items() if o in later]
        if not targets:
            unresolved.append({"stage": f"s{stage}", "reason": "no owner for a later ordinal"})
            continue
        for ev_id, ordinal in sorted(targets):
            if entry_gates.get(f"s{stage}", {}).get(str(ev_id)):
                continue                                 # the entry dispatcher already gates it
            if not any(e["id"] == ev_id for e in evs.get(f"s{stage}", [])):
                unresolved.append({"stage": f"s{stage}", "event": ev_id,
                                   "reason": "owner event is not in wstag_events.json"})
                continue
            g, why = gate_of(stage, ev_id, None)
            if g is None:
                unresolved.append({"stage": f"s{stage}", "event": ev_id,
                                   "ordinal": ordinal, "reason": why})
                continue
            g["ordinal_stored"] = ordinal
            out.setdefault(f"s{stage}", {})[str(ev_id)] = g

    OUT.write_text(json.dumps({
        "_comment": ("Start gate of each stage's LATER story beat, read from the tail of its "
                     "wstag dispatcher (the last ordinal re-read that reaches the call). "
                     "Generated by tools/extract_beat_event_gates.py. See that file for the "
                     "method and why the tail is the governing slice. The converter ANDs these "
                     "into every emit site that can start the event, exactly like "
                     "auto_event_gates.json."),
        "beats": out,
        "unresolved": unresolved,
    }, indent=1) + "\n")
    print(f"wrote {OUT} — {sum(len(v) for v in out.values())} gated later-beat events")
    for s, g in sorted(out.items()):
        for ev, info in sorted(g.items(), key=lambda kv: int(kv[0])):
            pretty = ", ".join((f"ord=={fid & 0xff}" if (fid & 0xFF00) == 0x6000
                                else f"flag 0x{fid:x}=={exp}") for fid, exp in info["conds"])
            print(f"  {s} event {ev} (stores 0x{info['ordinal_stored']:x}): {pretty}   [{info['slice']}]")
    for u in unresolved:
        print(f"  UNRESOLVED {u['stage']} event {u.get('event')}: {u['reason']}")


if __name__ == "__main__":
    main()