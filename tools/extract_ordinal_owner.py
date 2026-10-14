#!/usr/bin/env python3
"""Extract WHICH event's on_complete routine writes the master story ordinal
([0x8004b370], `sw $vX,-0x4c90`) and WHICH value it writes, per stage on the
story ladder -> web/assets/data/ordinal_owner.json.

Why this is needed: the master ordinal is the story's "where am I" number. The
original writes it from ONE event's on_complete routine per beat -- the beat's
CLOSING event, not its opening one (s200: event 52's `on_complete_fn` 324 =
wstag200.s .L0x144 `li $v0,4 / jr $ra / sw $v0,-0x4c90($v1)`; event 50's routine
.L0xf8 writes only 0x400d/0x7401). tools/extract_progress_ordinal.py already
reads the VALUE per stage; it cannot say which EVENT writes it, because the
`sw` sits inside a per-event native handler whose start is `on_complete_fn`.

Method (no emulator, no RAM):
  1. `on_complete_fn` in web/assets/events/wstag_events.json is a BYTE OFFSET into
     the wstagNNN overlay; `on_complete_fn_ram` == overlay_load + that offset
     (checked: s200 event 52 -> 0x800a5f24 - 0x144 == 0x800a5de0 == event 50's
     0x800a5ed8 - 0xf8). Word index = offset >> 2.
  2. Walk the routine's own control flow from that word: fall-through plus any
     conditional-branch target, stopping at `jr`/`jal` (no fall-through) and at any
     word that is the entry of a DIFFERENT event's on_complete routine in the same
     overlay (these leaf handlers are laid out contiguously and disjoint). `jalr`
     DOES fall through -- the setter calls get_flag/set_flag workers first.
  3. In the reached words, take every `sw $rt,0xb370(base)` (imm -0x4c90) and read
     the nearest preceding `li $rt,N` (`addiu $rt,$zr,N`) of the SAME register
     within LOOKBACK words. N is the ordinal the original stores.
  4. A stage's `owner` is every event whose routine contains such a store. Stages
     with no owner are listed in `unresolved` and the engine keeps its previous
     behaviour for them.

Output:
  { "ladder": [{stage, ordinals, owner: {eventId: ordinal}, unresolved:[...]}] }

Run: python3 tools/extract_ordinal_owner.py
"""
import os
import json
import re
from pathlib import Path

ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "web/assets/events/wstag_events.json"
LADDER = ROOT / "web/assets/data/progress_ordinal.json"
OUT = ROOT / "web/assets/data/ordinal_owner.json"
# The two decoded START GATES an event can carry: the stage-entry dispatcher's guard
# (auto_event_gates.json) and the dispatcher-tail guard for a stage's later beat
# (beat_event_gates.json). See tools/extract_auto_event_gates.py / extract_beat_event_gates.py.
# The stage-entry ARRIVAL chain (tools/extract_arrival_candidates.py, ported in
# engine/systems/scene-arrival.ts): a stage's entry object starts these event ids, each under its
# own conjunction. This replaced the two older gate tables, which read a TAIL SLICE of the chain
# and so covered 62 of the 131 candidates between them.
ARRIVAL_CHAINS = ROOT / "web/assets/data/scene/arrival_candidates.json"
# A decoded START an event can have besides the two dispatcher call sites:
#   * its stage's step program (tools/extract_story_steps.py) — an op-8 record is a
#     `start_event(id)` the position-triggered step VM performs, gated on the record's
#     own get_flag(cond,arg) pair (s810 record 30: `start_event(1035)` gated on
#     get_flag(0x6028)==1, i.e. story step 40, wstag810.s file 0x1e04).
#   * the bank-0x90 TALK LAUNCHER (tools/extract_talk_launch_bindings.py) —
#     `set_flag(bank 0x90, bit) = start_event(events[bit])`, the resident dispatcher
#     F0x800165ac -> fieldstg F0x8008bfa4 reads the u16 array at 0x800978d8 and calls
#     the same start_event (0x800853f8). The gate is the CONVERSATION: an NPC dialogue
#     state's own `on_close` writes the bank, behind that state's gate, and the record's
#     ordinal (bank 0x60) spawn_flags say on which story steps the character is there at
#     all. This used to be guessed from the event's own disassembly (`speaker_of`), which
#     found no speaker at all for s750 event 820 and so recorded NO start for the scene
#     that closes story step 32.
STEPS = ROOT / "web/assets/data/story_steps.json"
TALK_LAUNCH_BINDINGS = ROOT / "web/assets/data/talk_launch_bindings.json"
SCENES = ROOT / "web/assets/scenes"


def bank_60_npcs(stage):
    """{npc_id: [bank-0x60 predicate ids]} for a stage's scene NPCs — the ordinal gates
    that decide on which story step the character is standing there at all."""
    path = SCENES / f"s{stage}.json"
    if not path.exists():
        return {}
    out = {}
    for npc in json.loads(path.read_text()).get("npcs", []) or []:
        for sf in npc.get("spawn_flags") or []:
            fid = sf.get("id")
            if isinstance(fid, int) and (fid >> 8) == 0x60:
                out.setdefault(npc.get("npc_id"), []).append(fid)
    return out


def step_starts(stage):
    """{event_id: gate text} for every op-8 record in the stage's step program."""
    stages = json.loads(STEPS.read_text()).get("stages", {})
    out = {}
    for rec in (stages.get(str(stage), {}).get("steps") or []):
        if rec.get("op") != 8:
            continue
        gates = []
        for cond, arg in ((rec.get("cond_a"), rec.get("arg_a")), (rec.get("cond_b"), rec.get("arg_b"))):
            if cond is None or cond == 0xFFFF:
                continue
            gates.append(f"get_flag(0x{cond:04x})=={arg}"
                         + (" (story step)" if (cond >> 8) == 0x60 else ""))
        out.setdefault(int(rec["params"][0]), "step program op8: " + " and ".join(gates or ["ungated"]))
    return out


def talk_starts(events_json, stage, evs):
    """{event_id: gate text} for every event a CONVERSATION in this stage starts, gated on
    the dialogue state whose on_close writes the bank.

    Read from talk_launch_bindings.json — the shipped scenes' own dialogue-state on_close
    tables joined against the resident event-id array — not from the event's disassembly. The
    disassembly only ever said WHICH CHARACTER the scene talks to, never that the scene is
    started by that character's dialogue closing, so it both invented starts (every event
    whose first non-player SAY speaker happened to be an NPC) and missed them (s750 event
    820, whose bytecode names no speaker at all)."""
    bindings = json.loads(TALK_LAUNCH_BINDINGS.read_text()) if TALK_LAUNCH_BINDINGS.exists() else {}
    sites = (bindings.get("stages") or {}).get(f"s{stage}") or []
    gates = bank_60_npcs(stage)
    out = {}
    for site in sites:
        eid = int(site["event"])
        if site.get("in_stage") is False:
            continue
        if eid not in {e["id"] for e in evs}:
            continue
        npc = site.get("npc")
        steps = sorted(set(gates.get(npc, [])))
        step_txt = (f"npc {npc} exists only on story step flags {[hex(f) for f in steps]}"
                    if steps else f"npc {npc}")
        out.setdefault(eid, []).append(
            f"talk launcher bit {site['bit']}: {site['file']}#{site['index']} on npc {npc} "
            f"state {site['state']} closes ({step_txt})")
    return {k: "; ".join(v) for k, v in out.items()}

WORD_RE = re.compile(r"\.word\s+0x([0-9a-fA-F]{8})")
MAX_ORDINAL = 0x3FF        # incl. the 0x300 free-roam sentinel, same bound as the ladder
LOOKBACK = 6                # instructions to scan upward for the `li` that feeds the store


def words_of(path: Path):
    """[(word)] for a .s file, in file order; the .s listing is the overlay word stream."""
    out = []
    for line in path.read_text().splitlines():
        m = WORD_RE.search(line)
        if m:
            out.append(int(m.group(1), 16))
    return out


def op(w):
    return (w >> 26) & 0x3F


def rs(w):
    return (w >> 21) & 0x1F


def rt(w):
    return (w >> 16) & 0x1F


def imm16(w):
    i = w & 0xFFFF
    return i - 0x10000 if i & 0x8000 else i


def branch_target(w, idx, words):
    """Return the branch destination index, or None if `w` is not a branch."""
    o = op(w)
    if o in (0x02, 0x03):                       # j / jal (26-bit)
        return None if o == 0x03 else ((idx + 1 + ((w & 0x03FFFFFF) << 2)) >> 2) & 0xFFFFFFF
    if o in (0x04, 0x05, 0x06, 0x07):           # beq / bne / blez / bgtz
        pass
    elif o == 0x01:                             # REGIMM: bltz / bgez / bltzal …
        if rt(w) in (0x00, 0x01, 0x10, 0x11, 0x02, 0x03):
            pass
        else:
            return None
    else:
        return None
    return idx + 1 + imm16(w)


def is_return(w):
    """jr $ra / jal target -- control does not fall through."""
    if op(w) == 0x03:                           # jal
        return True
    return (w & 0x3F) == 0x08 and (op(w) == 0x00) and rs(w) == 31   # jr $ra


def routine_words(words, start, barrier, cap=256):
    """Every word index reachable from `start` inside this routine's own control flow."""
    seen, stack = set(), [start]
    while stack and len(seen) < cap:
        i = stack.pop()
        if i < 0 or i >= len(words) or i in seen or i in barrier:
            continue
        seen.add(i)
        w = words[i]
        # A `jr`/`jal` still EXECUTES its delay slot -- s200's whole setter is
        # `li $v0,4 / jr $ra / sw $v0,-0x4c90($v1)`, so the ordinal store IS the delay
        # slot. Visit it, then stop (control does not continue past the jump).
        if is_return(w):
            stack.append(i + 1)
            continue
        stack.append(i + 1)
        tgt = branch_target(w, i, words)
        if tgt is not None:
            stack.append(tgt)
    return seen


def decode_sw_ordinal(w):
    """If w is `sw $rt,0xb370(base)` return rt, else None."""
    if op(w) != 0x2B or (w & 0xFFFF) != 0xB370:
        return None
    return rt(w)


def decode_li(w, want_rt):
    """If w is `li $rt,N` return N, else None."""
    if op(w) != 0x09 or rs(w) != 0 or rt(w) != want_rt:
        return None
    return imm16(w)


def ordinal_stores(words, reach):
    """[(ordinal, word_offset_in_routine, is_reset)] written by the routine, in file order.

    A `sw $zr,0xb370` stores 0 with no `li` at all — wstag780.s .L0x1834, the completion
    routine of event 0. It is a real store of the ordinal (a RESET, the opening street
    scene's own write), so it is reported here; it is not a beat step (value 0 is the
    story's start, not a ladder rung), so the caller keeps it out of the owner map while
    the note records the truth.
    """
    out = []
    for i in sorted(reach):
        r = decode_sw_ordinal(words[i])
        if r is None:
            continue
        if r == 0:                       # $zr: the reset store, value 0
            out.append((0, i, True))
            continue
        for j in range(i - 1, max(-1, i - 1 - LOOKBACK), -1):
            n = decode_li(words[j], r)
            if n is not None:
                if 0 <= n <= MAX_ORDINAL:
                    out.append((n, i, False))
                break
    return out


def main():
    events = json.loads(EVENTS.read_text())
    ladder = json.loads(LADDER.read_text())
    arrival = json.loads(ARRIVAL_CHAINS.read_text()).get("stages", {})

    def gated(stage, ev_id):
        chain = arrival.get(f"s{stage}")
        chain = chain[0] if isinstance(chain, list) and chain else chain
        return bool(chain) and any(c["event"] == int(ev_id) for c in chain["candidates"])

    rows, unresolved = [], []
    for entry in ladder["ladder"]:
        stage, stage_ordinals = entry["stage"], entry["ordinals"]
        asm = ASM_DIR / f"wstag{stage}.s"
        if not asm.exists():
            unresolved.append({"stage": stage, "reason": "no wstag overlay in asm/dw2003/pro"})
            continue
        words = words_of(asm)
        evs = events.get(f"s{stage}", [])
        entries = {e["on_complete_fn"] >> 2 for e in evs if e.get("on_complete_fn")}
        # Every decoded way this stage's events can be STARTED, with the gate each one
        # carries. The two dispatcher call sites came first; the step program and the
        # bank-0x90 talk launcher are the other two the original has, and without them
        # s810/1035, s305/895, s520/695 and s685/690 read as "no decoded start" although
        # all four starts are in the extracted data.
        starts = {}
        chain = arrival.get(f"s{stage}")
        chain = chain[0] if isinstance(chain, list) and chain else chain
        for c in (chain or {}).get("candidates", []):
            gate = {"paths": c["paths"]}
            starts.setdefault(int(c["event"]), f"stage-entry arrival chain: {gate}")
        starts.update(step_starts(stage))
        for eid, gate in talk_starts(events, stage, evs).items():
            starts.setdefault(eid, gate)

        def gated(stage, ev_id):
            return int(ev_id) in starts

        owners, notes = {}, []
        for e in evs:
            off = e.get("on_complete_fn") or 0
            if not off:
                continue
            start = off >> 2
            # this routine must not run past the entry of a DIFFERENT event's routine
            barrier = entries - {start}
            reach = routine_words(words, start, barrier)
            all_stores = ordinal_stores(words, reach)
            resets = [s for s in all_stores if s[2]]
            stores = [s for s in all_stores if not s[2]]
            if not stores:
                if resets:
                    # A `sw $zr,0xb370` store: the routine DOES write the master ordinal,
                    # as a reset to 0 (wstag780.s .L0x1834, event 0's completion — the
                    # opening street scene). 0 is the story's start, not a ladder rung,
                    # so it is not a beat owner; the note says what the routine really is.
                    notes.append({"event": e["id"],
                                  "reason": "reset store only (sw $zr -> 0), not a beat step"})
                else:
                    notes.append({"event": e["id"], "reason": "no master-ordinal store in routine"})
                continue
            if len(stores) > 1:
                notes.append({"event": e["id"],
                              "reason": f"{len(stores)} ordinal stores {[n for n, _, _ in stores]}"})
            owners[str(e["id"])] = stores[0][0]
        if not owners:
            unresolved.append({"stage": stage, "reason": "no event routine writes 0x8004b370",
                               "events": notes})
            continue
        bad = sorted(v for v in owners.values() if v not in stage_ordinals)
        # INTERLOCK. On a stage with several beats in one room the owner rule only helps if the
        # LATER beat's closing event cannot fire on the FIRST visit -- otherwise the walker's
        # ungated row stores the later ordinal during the earlier beat and the story stalls one
        # beat later. We know that cannot happen only when we decoded a start gate for it (the
        # stage-entry dispatcher's guard, auto_event_gates.json, or the dispatcher tail slice,
        # beat_event_gates.json). Without one, this stage keeps the older ladder behaviour
        # (any completed event advances) rather than shipping a stall.
        later = set(stage_ordinals[1:])
        ungated = sorted(int(e) for e, o in owners.items()
                         if o in later and not gated(stage, e))
        if ungated:
            unresolved.append({
                "stage": stage,
                "reason": ("later-beat owner event has no decoded start gate "
                           f"{ungated} — stage keeps the ladder behaviour"),
                "events": {str(e): o for e, o in owners.items() if int(e) in ungated},
            })
            continue
        rows.append({"stage": stage, "ordinals": stage_ordinals, "owner": owners,
                     "off_ladder": bad, "notes": notes,
                     "starts": {str(k): v for k, v in sorted(starts.items())}})
        if bad:
            unresolved.append({"stage": stage, "reason": f"owner writes non-ladder value {bad}",
                               "events": owners})
    rows.sort(key=lambda r: (r["ordinals"][0], r["stage"]))
    OUT.write_text(json.dumps({
        "_comment": ("Which event's on_complete routine writes the master story ordinal "
                     "[0x8004b370] and the value it stores, per stage on the story ladder. "
                     "Generated by tools/extract_ordinal_owner.py from wstag_events.json "
                     "`on_complete_fn` + the wstagNNN.s overlay words. `owner` maps event id "
                     "-> stored ordinal. See field-script-engine-verified.md WS4.6."),
        "ladder": rows,
        "unresolved": unresolved,
    }, indent=1) + "\n")
    print(f"wrote {OUT} — {len(rows)} stages resolved, {len(unresolved)} unresolved")
    for r in rows:
        own = " ".join(f"{k}->{v}" for k, v in sorted(r["owner"].items(), key=lambda kv: int(kv[0])))
        print(f"  ords[{','.join(hex(o) for o in r['ordinals'])}] s{r['stage']:<4} {own}")
    for u in unresolved:
        print(f"  UNRESOLVED s{u['stage']}: {u['reason']}")


if __name__ == "__main__":
    main()
