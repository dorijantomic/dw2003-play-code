"""
Story-step program extractor — the per-stage WS4 step VM program + event table.

The field story sequencer (docs/research/field-script-engine-verified.md §WS4) runs a
per-stage **step program**: 24-byte records selected by the player's position (a type-7
zonecheck grid → step index) and gated by story flags (`get_flag(cond_a/cond_b)`), each
firing one opcode (spawn / start_event / handoff / actor anim). This tool reconstructs
that program (and the adjacent event table that `start_event` indexes) from each WSTAGNNN
overlay, offline — no emulator.

## Layout (verified on s200, base RAM 0x800A5DE0)

Two adjacent static tables sit near the end of each overlay:

  - **Step program** (`scene+0x14`, s200 = 0x800a7f30 / file 0x2150): N×24-byte records
        { u16 cond_a, u16 arg_a, u16 cond_b, u16 arg_b, u16 opcode, u16 params[7] }
    `cond==0xffff` = unconditional; otherwise `get_flag(cond, arg)` must be nonzero or
    the step is skipped. `opcode==0` terminates the program. (s200 = 7× op-1 spawns +
    terminator; idx0 gated on cond_a=0x7007.)
  - **Event table** (`scene+0x18`-ish, s200 = 0x800a7ff0 / file 0x2210): M×20-byte records
        { u32 scriptA, u32 event_id, u32 scriptB, u32 flag_key, u32 rsvd }
    terminated by `event_id == 0xffffffff`. `start_event(event_id)` (step op-8) looks up
    this table; the bytecode of each event is already in `wstag_events.json` (matched here
    by flag_key, which is also how we *locate* the table).

## Location strategy (robust, data-anchored)

The two tables aren't at a fixed offset across overlays, and the pointer is built by a
per-overlay `lui/addiu; sw …,0x14(scene)` we'd have to disassemble. Instead we anchor on
**known data**: scan for the 20-byte event-table run whose `flag_key`s match the stage's
events in `wstag_events.json` and which ends in the `0xffffffff` terminator. The step
program is the 24-byte record run immediately before it, ending in an `opcode==0`
terminator. Both are then validated structurally.

Output: `web/assets/data/story_steps.json`
    { "stages": { "200": { "steps": [ {cond_a,arg_a,cond_b,arg_b,op,params:[7]} … ],
                            "events": [ {event_id, flag_key} … ] } } }

Usage:
  python3 tools/extract_story_steps.py            # writes the json
  python3 tools/extract_story_steps.py --print    # human-readable dump
"""

import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_extract as W

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "web/assets/events/wstag_events.json"
OUT = ROOT / "web/assets/data/story_steps.json"

STEP = 24   # step record size
EVREC = 20  # event record size
BASE = 0x800A5DE0        # WSTAG overlay RAM base; file_offset = ram - BASE
INIT_SCAN_BYTES = 0x1200  # historical: the store is NOT confined to this window (see
                        # step_program_ptr); kept only to name what the old bound was
MAX_STEPS = 128          # runaway guard when walking forward from the pointer


# NOTE: step conditions are NOT limited to 0xffff/0x70xx — real programs carry types
# like 0x8005 (e.g. s202 op-7 records). The *opcode* (0 terminator, 1..14 step) is the
# reliable structural field, so boundary detection keys on it, not on cond.


def find_event_table(data, flag_keys):
    """Locate the 20-byte event table by matching flag_keys (record +0xc) and the
    0xffffffff terminator. Returns (offset, [(event_id, flag_key), …]) or None.

    A run may also END on a record that fails the plausibility test once it has
    already placed every flag_key worth placing (wstag810.s: the table at file
    0x21f4 places 01510006/07/08/0b and the 9000-series hazard id, then the
    record at 0x2254 carries event_id 0 with 0x2329 in its flag_key slot — a
    degenerate tail. Discarding the whole run there cost s810 its event table
    AND its 54-record step program, which is where `start_event(1035)` — the
    routine that writes story step 41 — lives. Zero flag_keys carry no
    information (the hazard stages list seventeen of them), so a run is accepted
    once every NON-ZERO wanted key is placed and nothing outside `want` was."""
    want = {int(k, 16) for k in flag_keys}
    if not want:
        return None
    want_nz = {k for k in want if k != 0}
    n = len(data)
    for off in range(0, n - EVREC, 4):
        recs, o, matched, ended_bad, degenerate = [], off, set(), False, False
        while o + EVREC <= n:
            sa, eid, sb, fk, _ = struct.unpack_from("<IIIII", data, o)
            if eid == 0xFFFFFFFF:
                break
            # a plausible record: scriptA in RAM (0x80…), event_id in the same
            # range wstag_events.py accepts (it breaks at > 0x7fff), flag_key
            # known. The old 0x1000 ceiling silently rejected the 9000-series
            # ids the dungeon-hazard stages use (s740/s741 events 9000..9015),
            # so those tables never resolved and their stages shipped with an
            # empty `events` list.
            if (sa >> 24) == 0x80 and 0 < eid <= 0x7FFF and fk in want:
                recs.append((eid, fk)); matched.add(fk); o += EVREC
            else:
                # A run that dies on anything but an all-zero record is over (that is
                # the rule every stage but s810 was resolved under). An all-zero tail
                # is a degenerate close: wstag810.s 0x2258 reads (0, 9001, 0, 0, 0)
                # because that hazard record's handler word sits 4 bytes early.
                ended_bad = True
                degenerate = sa == 0 and sb == 0 and fk == 0
                break
        if not recs or not matched <= want:
            continue
        if (matched == want and not ended_bad) or (degenerate and want_nz and want_nz <= matched):
            return off, recs
    return None


# The flag API's set_flag slot. Stubs reach it two ways: through the struct base
# (`lui/addiu` to 0x80048abc, then `lw rt,0xc(rs)`) or with the displacement
# folded into the load (`lui rs,0x8005; lw rt,-0x7538(rs)`). Both name the same
# word, so both must count — the folded form is what the per-trap one-line stubs
# in the dungeon-hazard overlays use, and matching only `+0xc` silently returned
# "this event sets nothing" for every one of them.
SET_FLAG_PTR = 0x80048AC8


def li_imm(word):
    """(reg, value) when word loads a small constant or zero into a register.

    set_flag's arguments are written as `addiu rt,zero,imm` (ids < 0x8000),
    `ori rt,zero,imm` (ids >= 0x8000, e.g. the collection bank 0x82xx) or
    `addu rd,zero,zero` (a clear's value 0, often in the jalr delay slot)."""
    if (word >> 21) & 31:
        return None                                   # rs must be zero
    op = word >> 26
    if op in (9, 0xD):                                # addiu / ori
        return (word >> 16) & 31, word & 0xFFFF
    if op == 0 and ((word >> 16) & 31) == 0 and (word & 0x7FF) == 0x21:
        return (word >> 11) & 31, 0                   # addu rd, zero, zero
    return None


def oncomplete_flag_sets(data, off):
    """The `set_flag(id, val)` calls an event's on_complete performs. set_flag is
    `(*[flagapi+0xc])(a0=id, a1=val)`; we track a0/a1 immediates and jalr through a
    register holding that pointer, scanning from on_complete_fn to `jr $ra`. Returns
    [[id, val], …] (the flag values, banked-bitfield ids — see §WS4.3)."""
    if not off:
        return []
    a0 = a1 = None
    setptr_regs = set()
    upper = {}                                   # reg -> lui immediate << 16
    out = []
    end = min(off + 0x200, len(data) - 4)
    for i in range(off, end, 4):
        w = struct.unpack_from("<I", data, i)[0]
        op = w >> 26
        rs = (w >> 21) & 31
        rt = (w >> 16) & 31
        imm = w & 0xFFFF
        simm = imm - 0x10000 if imm & 0x8000 else imm
        if w == 0x03E00008:                      # jr $ra → end of function
            break
        load = li_imm(w)
        if load is not None:
            if load[0] == 4: a0 = load[1]
            elif load[0] == 5: a1 = load[1]
        elif op == 0x0F:                         # lui rt,imm
            upper[rt] = imm << 16
        elif op == 0x23:                         # lw rt,off(rs)
            if simm == 0xC or upper.get(rs, 0) + simm == SET_FLAG_PTR:
                setptr_regs.add(rt)
            else:
                setptr_regs.discard(rt)
        elif op == 0 and (w & 0x3F) == 9:        # jalr rs
            # The argument setup may sit in the branch DELAY SLOT, which a linear
            # walk would otherwise not reach until after the call.
            if i + 4 < end:
                d = struct.unpack_from("<I", data, i + 4)[0]
                load = li_imm(d)
                if load is not None:
                    if load[0] == 4: a0 = load[1]
                    elif load[0] == 5: a1 = load[1]
            if rs in setptr_regs and a0 is not None:
                out.append([a0, a1 if a1 is not None else 1])
    return out


def read_step_program(data, et_off):
    """The 24-byte step records immediately before the event table, in program order.
    The program ends in an op-0 terminator (at et_off-24); walking back, step records
    carry op 1..14, and the program START is bounded by the *preceding* op-0 (the prior
    table's terminator/padding) or any non-step word (op>14)."""
    o = et_off - STEP
    ca, aa, cb, ab, op = struct.unpack_from("<HHHHH", data, o)
    if op != 0:
        return []                                       # no terminator here → not the program
    recs = [(ca, aa, cb, ab, op, list(struct.unpack_from("<7H", data, o + 10)))]
    o -= STEP
    while o >= 0:
        ca, aa, cb, ab, op = struct.unpack_from("<HHHHH", data, o)
        if not (1 <= op <= 14):                          # op-0 boundary or non-step word → stop
            break
        recs.insert(0, (ca, aa, cb, ab, op, list(struct.unpack_from("<7H", data, o + 10))))
        o -= STEP
    return recs


def stage_list():
    return sorted(int(m.group(1)) for p in W.ASM_DIR.glob("wstag*.s")
                  if (m := re.fullmatch(r"wstag(\d+)", p.stem)))


def step_program_ptr(data):
    """The program pointer the stage init stores into `scene_struct+0x14`.

    The docstring above notes this pointer exists but is built by a per-overlay
    `lui/addiu; sw …,0x14(scene)`; the original strategy avoided disassembling for
    it and anchored on the event table instead. That anchor is why coverage was
    98/294: `extract()` skipped every stage with no events, which is every maze
    stage (s860-s895, s96x/s97x), and their entrances went missing.

    A two-register constant fold over the init is enough to recover it. Verified
    on wstag320: the lui/addiu completing at file 0x184 builds 0x800a71b0 and the
    NEXT instruction (file 0x188) is `sw r2, 0x14(r17)`; 0x800a71b0 - BASE =
    file 0x13d0, byte-exact where the known s320 program starts.

    Evidence: EV-step-program-pointer-scene-0x14-2026-07-27 (authority 2).

    ## The window was the remaining gap (2026-10-03)

    The fold ran over the first `INIT_SCAN_BYTES` (0x1200) bytes only, on the
    assumption that the store sits in the init prologue. It does not, in every
    overlay: s210 stores at file **0x17f8** and s220 at **0x1344**, both past
    0x1200, so those two stages found nothing — and both have a type-7 grid
    that names their six and two door records. Scanning the whole overlay is the
    fix; nothing else about the strategy changes.

    ## The fold also reported stores it could not see (2026-10-03)

    A register kept its folded value across writes that overwrite it. wstag780
    0x10a0-0x10ac is `lw $v1,0x14($s0) / addu $v1,$v0 / sw $v1,0x14($s0)` — the
    stored word is a function's RETURN VALUE, but `addu` is not a fold instruction,
    so `regs[$v1]` still held some earlier `lui/addiu` and the store was reported
    at an address whose contents are not a step program. Every destination
    register now loses its folded value on any instruction that is not part of
    the fold, so a reported store always names a value the fold actually built.

    ## Acceptance is parse, not position

    The first candidate whose 24-byte run walks to an op-0 terminator wins, so a
    wide scan cannot be fooled by an unrelated `+0x14` field further into the
    overlay. Measured over all 294 overlays: 8 stages gain a program (s205, s210,
    s220, s310, s311, s460, s526, s800), none of the 287 that already had one
    changes, and of the six gains that have an event-table anchor the pointer read
    is byte-identical to the anchored walk on all six.
    """
    regs = {}
    for o in range(0, len(data) - 4, 4):
        w = struct.unpack_from("<I", data, o)[0]
        op, rs, rt, imm = w >> 26, (w >> 21) & 31, (w >> 16) & 31, w & 0xFFFF
        simm = imm - 0x10000 if imm & 0x8000 else imm
        if op == 0x0F:                                   # lui rt, imm
            regs[rt] = imm << 16
            continue
        if op in (9, 0x0D) and rs in regs:               # addiu / ori rt, rs, imm
            regs[rt] = ((regs[rs] + simm) & 0xFFFFFFFF) if op == 9 else (regs[rs] | imm)
            continue
        if op == 0x2B and imm == 0x14:                   # sw rt, 0x14(rs)
            v = regs.get(rt)
            if v is not None and BASE <= v < BASE + len(data) \
                    and read_step_program_at(data, v - BASE):
                return v - BASE
        # Any other write to a register kills its folded value, so a store is
        # never attributed a constant the fold did not build there.
        for d in _written_regs(w):
            regs.pop(d, None)
    return None


def _written_regs(w):
    """Registers whose prior contents `w` destroys, so a folded constant is stale.

    Deliberately conservative in both directions: anything not listed is treated
    as writing `rt`, and the register-immediate ops that feed the fold are the
    only ones the caller skips."""
    op, fn = w >> 26, w & 0x3F
    rt = (w >> 16) & 31
    if op == 0:                                          # SPECIAL
        if fn in (0, 2, 3, 9):                           # sll / srl / sra / jalr -> rd
            return ((w >> 11) & 31,)
        return ()                                        # jr, mult/div, traps: no reg
    if op in (0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
              0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x20, 0x2A):
        return ()                                        # branches, traps, fp stores
    if op in (0x0F, 0x09, 0x0D, 0x0C, 0x0A, 0x0B, 0x0E):
        return ()                                        # the fold's own immediates
    return (rt,)                                         # every other op writes rt


def read_step_program_at(data, off):
    """Walk FORWARD from a known program start over 24-byte records to the op-0
    terminator. The inverse of read_step_program(), which walks back from the
    event table; used when the pointer is known and no event anchor exists."""
    recs = []
    while off + STEP <= len(data):
        ca, aa, cb, ab, op = struct.unpack_from("<HHHHH", data, off)
        recs.append((ca, aa, cb, ab, op, list(struct.unpack_from("<7H", data, off + 10))))
        if op == 0:
            return recs
        if not (1 <= op <= 14) or len(recs) > MAX_STEPS:
            return []                                    # not a program
        off += STEP
    return []


def extract(events):
    """Steps come from the `scene+0x14` pointer; events still need the data anchor.

    The two are independent now: a stage with a program but no events is emitted
    with `events: []` (189 stages gain a program this way), and the anchored walk
    remains as a fallback and as a cross-check wherever both are available.
    """
    out, agree, disagree = {}, 0, []
    for st in stage_list():
        data = W.overlay_bytes(str(st))
        if data is None:
            continue
        evs = events.get("s%d" % st) or []

        # Event table (and its anchored step program, kept for cross-check/fallback).
        ev_recs, anchored = [], None
        if evs:
            loc = find_event_table(data, [e["flag_key"] for e in evs])
            if loc:
                et_off, ev_recs = loc
                anchored = read_step_program(data, et_off) or None

        # STRICTLY ADDITIVE. The anchored program wins wherever it exists, so the
        # 98 stages this tool already covered are byte-for-byte unchanged and no
        # regression is structurally possible; the pointer only fills stages that
        # had NOTHING. See the caveat below for why the pointer is not trusted to
        # override.
        ptr = step_program_ptr(data)
        pointed = read_step_program_at(data, ptr) if ptr is not None else []
        if pointed and anchored:
            if [(r[4], r[5]) for r in pointed] == [(r[4], r[5]) for r in anchored]:
                agree += 1
            else:
                disagree.append(st)
        steps = anchored or pointed

        # Per-event on_complete flag-sets (the story-graph edges that open later gates).
        # Keyed by EVENT ID, not flag_key: flag_key is not unique. A dungeon-hazard
        # stage gives every trap event flag_key 0 and distinguishes them only by id
        # (s740/s741 events 9000..9015 each set their own gate flag 0x40aa+n from
        # their own on_complete stub), so a flag_key-keyed map collapsed all 17
        # records onto whichever one happened to be last and lost every set.
        #
        # The 20-byte event table is only ONE route to a stage's events: 26 stages
        # (dialogue/native-dispatched, e.g. s270/s285/s305/s395/s500/s810) carry a
        # wstag_events catalog but no table record at all, so the anchor's `ev_recs`
        # is empty and their on_complete sets were never read. Attach sets for every
        # catalog event that has a hook, anchored or not; the anchor still supplies
        # the flag_key where it exists (it and the catalog agree on every stage where
        # both resolve — checked 2026-09-11, 113/113 stages, 0 extras, 0 mismatches).
        oc = {e["id"]: e.get("on_complete_fn", 0) for e in evs}
        anchor_fk = {eid: "%08x" % fk for eid, fk in ev_recs}
        events_out = [
            {"event_id": eid, "flag_key": anchor_fk.get(eid, "%08x" % fk),
             "sets": oncomplete_flag_sets(data, oc.get(eid, 0))}
            for (eid, fk) in ev_recs
        ]
        seen = {e["event_id"] for e in events_out}
        events_out.extend(
            {"event_id": e["id"], "flag_key": e["flag_key"],
             "sets": oncomplete_flag_sets(data, oc[e["id"]])}
            for e in evs if e["id"] not in seen
        )
        if not steps and not events_out:
            continue

        out[st] = {
            "steps": [
                {"cond_a": ca, "arg_a": aa, "cond_b": cb, "arg_b": ab, "op": op, "params": p}
                for (ca, aa, cb, ab, op, p) in steps
            ],
            "events": events_out,
        }
    # CAVEAT — why the pointer does NOT override the anchor.
    #
    # Some inits choose between VARIANT programs with a story-ordinal branch, the
    # same shape as the encounter zone-group selector. s615 is the proven case:
    # `slti 0x15` at file 0x278, then two candidate pointers, 0x800a7360 (routing
    # to s620) and 0x800a73d8 (routing to s625), feeding ONE `sw …,0x14` through a
    # branch. A linear constant-fold therefore reports only the fall-through
    # variant and silently drops the other route — letting the pointer override
    # the anchor here made s620 unreachable.
    #
    # Counting `sw …,0x14` sites cannot detect this (both addiu feed one store),
    # and "an init address that parses as a step program" is far too weak a filter
    # to detect it either: for s200 that also matches the event table, which is
    # step-record-shaped by coincidence. So the number of gated stages is NOT
    # bounded, and the pointer is used only where the anchor has nothing — where
    # any program is strictly more than the nothing that was there before.
    #
    # Those 189 pointer-only stages may individually be showing one variant of a
    # gated pair. docs/todo/2026-07-27-step-program-coverage-via-scene-0x14.md.
    #
    # s530 joined this list when the event-id ceiling above was widened and its
    # table (a single 9000-series event) started resolving. It is the SAME shape
    # as s615, checked record-by-record: two adjacent 5-record variants that
    # differ only in the second spawn's id (579 vs 580), the pointer selecting
    # the later one and the anchor spanning both. Handled by the same rule.
    assert set(disagree) <= {530, 615}, f"unexpected pointer/anchor disagreement: {disagree}"
    print(f"step programs: pointer+anchor agree on {agree}, "
          f"known gated-variant diff {sorted(disagree)} (anchor kept)")
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    events = json.loads(EVENTS.read_text())
    stages = extract(events)
    if not stages:
        print("no step programs located — layout changed?", file=sys.stderr)
        return 1

    # Keystone (s200, the live-verified Genji stage): 7 spawn steps (op 1) + terminator,
    # idx0 gated on cond_a=0x7007, and the event table = {0x32:0112000b, 0x34:0112000c}.
    s200 = stages[200]
    ops = [s["op"] for s in s200["steps"]]
    assert ops == [1, 1, 1, 1, 1, 1, 1, 0], f"s200 step opcodes changed: {ops}"
    assert s200["steps"][0]["cond_a"] == 0x7007, f"s200 idx0 cond changed: {s200['steps'][0]}"
    assert [(e["event_id"], e["flag_key"]) for e in s200["events"]] == \
        [(0x32, "0112000b"), (0x34, "0112000c")], f"s200 event table changed: {s200['events']}"

    # set_flag argument-load regressions. wstag736 event 1294 sets flag 0x4083 (addiu) then
    # the collection flag 0x8230 (ori — ids >= 0x8000); losing the ori form repeated 0x4083.
    # wstag212 event 352 CLEARS 0x4005, whose value 0 is `move a1,zero` in the jalr delay
    # slot; losing that form defaulted the value to 1 and set the flag instead.
    s736_1294 = next(e for e in stages[736]["events"] if e["event_id"] == 1294)
    assert s736_1294["sets"] == [[0x4083, 1], [0x8230, 1]], \
        f"wstag736 event 1294 sets changed: {s736_1294['sets']}"
    s212_352 = next(e for e in stages[212]["events"] if e["event_id"] == 352)
    assert s212_352["sets"] == [[0x4005, 0]], \
        f"wstag212 event 352 sets changed: {s212_352['sets']}"

    # Catalog-only events (no 20-byte table; the anchor returns nothing). Before the
    # fallback these stages shipped `events: []` and every on_complete flag write was
    # lost. s500's position-gated event 250 and s810 (absent from story_steps entirely)
    # pin both halves of the fallback.
    s500_250 = next(e for e in stages[500]["events"] if e["event_id"] == 250)
    assert s500_250["sets"] == [[0x400A, 1], [0x1A32, 1]], \
        f"wstag500 event 250 sets changed: {s500_250['sets']}"
    s810_990 = next(e for e in stages[810]["events"] if e["event_id"] == 990)
    assert s810_990["sets"] == [[0x406D, 1], [0x1C3A, 1]], \
        f"wstag810 event 990 sets changed: {s810_990['sets']}"

    n_op8 = sum(s["op"] == 8 for st in stages.values() for s in st["steps"])
    if "--print" in argv:
        for st in sorted(stages):
            b = stages[st]
            print(f"s{st}: {len(b['steps'])} steps  events={[hex(e['event_id']) for e in b['events']]}")
            for i, s in enumerate(b["steps"]):
                gate = "" if s["cond_a"] == 0xFFFF else f"  if flag({hex(s['cond_a'])},{s['arg_a']})"
                print(f"   [{i}] op{s['op']} params={s['params']}{gate}")

    payload = {
        "_comment": ("Per-stage WS4 story-step programs + event tables, reconstructed from "
                     "each WSTAGNNN overlay. steps = 24-byte records {cond_a,arg_a,cond_b,"
                     "arg_b,op,params[7]} run by the position-triggered step VM (op8=start_event, "
                     "op1=spawn, etc.; cond 0xffff=unconditional else get_flag(cond,arg)); op0 "
                     "terminates. events = the start_event lookup table (event_id→flag_key; "
                     "bytecode is in wstag_events.json). See docs/research/"
                     "field-script-engine-verified.md §WS4."),
        "stages": {str(st): stages[st] for st in sorted(stages)},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(stages)} stages, {n_op8} position-triggered start_event steps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
