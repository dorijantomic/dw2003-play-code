#!/usr/bin/env python3
"""Extract story gates for auto-cutscene (`start_event`) calls from wstag overlays.

Each wstag overlay's stage-entry dispatcher decides which event to auto-start on
map entry by testing the master story ordinal ([0x8004b370]) and per-event
get_flag predicates, then calling `start_event(id)` (jal 0x800853f8) with the
chosen event id in $a0.  The converter, lacking these gates, emits every
player-puppeting event as an *unconditional* OnEnterMap auto-cutscene — so e.g.
the Wind Prairie (s395) Teddy/Lucky-Mouse scene fires on first entry from
Divermon's Lake instead of only after Seiryu City (ordinal 5).

This tool recovers the gate by tracing the dispatcher's control flow.  For every
`jal start_event` it walks all paths from the containing function's entry,
collecting the ordinal-equality and get_flag constraints that must hold to reach
that call, and the event id ($a0) live at the call (event ids are loaded in the
branch/jal *delay slots*, which MIPS executes before the transfer).

Output: web/assets/data/auto_event_gates.json
    { stage : { event_id : { "conds": [[flagId, expected], ...] } } }

`conds` are engine `flag` leaves (AND-ed).  Ordinal equality `ordinal==N` is
encoded as the virtual ordinal bank: flagId = 0x6000|N, expected 1 (and
`ordinal!=N` as expected 0).  A get_flag(flag, exp) that must be TRUE on the path
becomes [flag, exp]; one that must be FALSE becomes [flag, exp^1] (bank-0x40 bits
are boolean).  See docs/research/scripting/get-flag-banked-predicate-system.md.

Only "clean" gates are emitted: an event reached by exactly one path whose
constraint set contains at least one positive ordinal-equality.  Fall-through /
default events (reached via negated ordinals or multiple paths) are left ungated
so the converter keeps its current behaviour for them — we never fabricate a gate
we can't prove.
"""
import os
import json, re
from pathlib import Path

ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
OUT = Path(__file__).resolve().parent.parent / "web/assets/data/auto_event_gates.json"

WORD_RE = re.compile(r"\.word\s+0x([0-9a-fA-F]{8})")
JAL_START_EVENT = 0x0c0214fe          # jal 0x800853f8
GETFLAG_ABS = 0x80048ACC             # get_flag fn ptr
FNBASE_ABS = 0x80048ABC              # fn-table base (some overlays index it: +0x10 = get_flag)
MAX_EVENT_ID = 0x1800                 # plausible event-id ceiling (above = flag id / other)
MAX_PATHS = 4000                      # per-call path explosion guard


def words_of(path):
    return [int(WORD_RE.search(l).group(1), 16)
            for l in path.read_text().splitlines() if WORD_RE.search(l)]


# ── instruction decode (only the fields the dispatcher idiom uses) ──
def op(w):       return w >> 26
def rs(w):       return (w >> 21) & 0x1F
def rt(w):       return (w >> 16) & 0x1F
def rd(w):       return (w >> 11) & 0x1F
def imm(w):      return w & 0xFFFF
def simm(w):     i = w & 0xFFFF; return i - 0x10000 if i & 0x8000 else i


def decode(w):
    """Return a small tagged tuple describing the instruction, or ('other',)."""
    o = op(w)
    if w == JAL_START_EVENT:                     return ("start_event",)
    if o == 0x0F:                                return ("lui", rt(w), imm(w) << 16)        # lui rt, imm
    if o == 0x09:                                return ("addiu", rt(w), rs(w), simm(w))     # addiu rt, rs, imm
    if o == 0x0D:                                return ("ori", rt(w), rs(w), imm(w))        # ori rt, rs, imm
    if o == 0x23:                                return ("lw", rt(w), rs(w), simm(w))        # lw rt, off(rs)
    if o == 0x03:                                return ("jal",)                              # jal (non-start_event)
    if o == 0x00 and (w & 0x3F) == 0x09:         return ("jalr", rs(w))                       # jalr rs
    if o == 0x00 and (w & 0x3F) == 0x08:         return ("jr", rs(w))                          # jr rs
    if o == 0x00 and (w & 0x3F) in (0x20, 0x21, 0x25):                                          # add/addu/or
        return ("move", rd(w), rs(w), rt(w))     # canonical `move rd, src` (other operand $zero)
    if o == 0x04:                                return ("beq", rs(w), rt(w), simm(w))        # beq/beqz
    if o == 0x05:                                return ("bne", rs(w), rt(w), simm(w))        # bne/bnez
    return ("other",)


def find_functions(ws):
    """Return (entry_idx, end_idx) covering each function: entry = prologue word,
    end_idx = one past the `jr $ra` delay slot."""
    bounds, start = [], 0
    for i, w in enumerate(ws):
        d = decode(w)
        if d[0] == "jr" and d[1] == 31:           # jr $ra
            bounds.append((start, i + 2))          # include the jr and its delay slot
            start = i + 2
    return bounds


def apply_regs(w, regs):
    """Commit an instruction's destination-register effect into regs (in place)."""
    d = decode(w); k = d[0]
    if k == "move":
        _, dst, sa, sb = d
        src = sa if sb == 0 else (sb if sa == 0 else None)   # `move dst, src` (other = $zero)
        regs[dst] = ("imm", 0) if src == 0 else regs.get(src)
    elif k == "lui":
        regs[d[1]] = ("addr", d[2])
    elif k == "addiu":
        base = regs.get(d[2])
        if d[2] == 0:
            regs[d[1]] = ("imm", d[3])
        elif base and base[0] == "addr":
            regs[d[1]] = ("addr", (base[1] + d[3]) & 0xFFFFFFFF)
        else:
            regs[d[1]] = None
    elif k == "ori":
        base = regs.get(d[2])
        if d[2] == 0:
            regs[d[1]] = ("imm", d[3])
        elif base and base[0] == "addr":
            regs[d[1]] = ("addr", (base[1] | d[3]) & 0xFFFFFFFF)
        else:
            regs[d[1]] = None
    elif k == "lw":
        base = regs.get(d[2]); addr = None
        if base and base[0] == "addr":
            addr = (base[1] + d[3]) & 0xFFFFFFFF
        if d[3] == -0x4C90 or addr == 0x8004B370:
            regs[d[1]] = ("ordinal",)
        elif addr in (GETFLAG_ABS, FNBASE_ABS + 0x10):
            regs[d[1]] = ("fnptr_getflag",)
        else:
            regs[d[1]] = None


def apply_args(w, regs, a0, a1):
    """Return updated ($a0, $a1) immediates after an instruction (for arg tracking)."""
    d = decode(w)
    if d[0] in ("addiu", "ori") and d[1] in (4, 5):
        if d[2] == 0:
            val = ("imm", d[3])
        else:
            base = regs.get(d[2])
            val = ("addr", (base[1] + d[3]) & 0xFFFFFFFF) if base and base[0] == "addr" else None
        return (val, a1) if d[1] == 4 else (a0, val)
    if d[0] == "move" and d[1] in (4, 5):
        _, dst, sa, sb = d
        src = sa if sb == 0 else (sb if sa == 0 else None)
        val = ("imm", 0) if src == 0 else regs.get(src)
        return (val, a1) if dst == 4 else (a0, val)
    if d[0] == "lw" and d[1] in (4, 5):
        return (None, a1) if d[1] == 4 else (a0, None)
    return a0, a1


def branch_constraint(d, regs):
    """For beq/bne, return (taken_constraint, nottaken_constraint) as (flagId, exp)
    tuples, or (None, None) when not a recognised ordinal/get_flag test."""
    _, a, b, _ = d
    ra, rb = regs.get(a), regs.get(b)
    # ordinal == imm
    ordv = immv = None
    for x, y in ((ra, rb), (rb, ra)):
        if x and x[0] == "ordinal" and y and y[0] == "imm":
            ordv, immv = x, y[1]
    if ordv is not None and 0 <= immv < 0x200:
        fid = 0x6000 | immv
        return ((fid, 1), (fid, 0)) if d[0] == "beq" else ((fid, 0), (fid, 1))
    # get_flag result tested against zero
    res = None
    if b == 0 and ra and ra[0] == "getflag":   res = ra
    elif a == 0 and rb and rb[0] == "getflag":  res = rb
    if res is None:
        return None, None
    flag, exp = res[1], res[2]
    true_leaf, false_leaf = (flag, exp), (flag, exp ^ 1)
    # beqz: taken → result==0 → predicate FALSE ;  bnez: taken → predicate TRUE
    return (false_leaf, true_leaf) if d[0] == "beq" else (true_leaf, false_leaf)


def feasible(guards, newc):
    """False if adding ordinal constraint `newc` contradicts an existing one (the dispatcher's
    ordinal is a single value within one entry, so ord==N & ord==M (N!=M) or ord==N & ord!=N is
    impossible — those paths are an artefact of forking ordinal compares and must be pruned)."""
    if newc is None or (newc[0] & 0xFF00) != 0x6000:
        return True
    n, exp = newc[0] & 0xFF, newc[1]
    for f, e in guards:
        if (f & 0xFF00) != 0x6000:
            continue
        m = f & 0xFF
        if e == 1 and exp == 1 and m != n:  return False   # ord==m and ord==n
        if e == 1 and exp == 0 and m == n:  return False   # ord==n and ord!=n
        if e == 0 and exp == 1 and m == n:  return False   # ord!=n and ord==n
    return True


def trace_call(ws, entry, end, call_idx):
    """DFS all paths entry→call_idx. Return {event_id: [constraint_set, ...]}."""
    results, npaths = {}, [0]

    def run(idx, regs, a0, a1, guards, visited):
        while True:
            if npaths[0] > MAX_PATHS or idx < entry or idx >= end or idx in visited:
                return
            visited = visited | {idx}
            w = ws[idx]; d = decode(w); k = d[0]

            if k == "start_event":
                a0d, _ = apply_args(ws[idx + 1], regs, a0, a1)   # delay slot sets the event id
                ev = a0d[1] if a0d and a0d[0] == "imm" else None
                if ev is not None and 0 < ev < MAX_EVENT_ID:
                    results.setdefault(ev, []).append(list(guards))
                    npaths[0] += 1
                return

            if k in ("beq", "bne"):
                target = idx + 1 + d[3]
                a0d, a1d = apply_args(ws[idx + 1], regs, a0, a1)   # delay slot (both forks)
                regs2 = dict(regs); apply_regs(ws[idx + 1], regs2)
                ra, rb = regs.get(d[1]), regs.get(d[2])
                # ordinal vs ordinal (the dispatcher reloads the unchanging ordinal): deterministic
                # — beq always taken, bne never taken — so don't fork an impossible branch.
                if ra and ra[0] == "ordinal" and rb and rb[0] == "ordinal":
                    if k == "beq":
                        run(target, dict(regs2), a0d, a1d, list(guards), visited)
                        return
                    idx, regs, a0, a1 = idx + 2, regs2, a0d, a1d
                    continue
                gt, gf = branch_constraint(d, regs)
                if feasible(guards, gt):
                    run(target, dict(regs2), a0d, a1d, guards + ([gt] if gt else []), visited)
                if not feasible(guards, gf):
                    return                                  # fall-through path is infeasible
                idx, regs, a0, a1, guards = idx + 2, regs2, a0d, a1d, guards + ([gf] if gf else [])
                continue

            if k == "jalr":
                tag = regs.get(d[1])
                # the delay slot executes before the call, so args are the post-delay values
                a0d, a1d = apply_args(ws[idx + 1], regs, a0, a1)
                regs2 = dict(regs); apply_regs(ws[idx + 1], regs2)
                if tag == ("fnptr_getflag",) and a0d and a0d[0] == "imm" and a1d and a1d[0] == "imm":
                    regs2[2] = ("getflag", a0d[1], a1d[1])         # $v0 = get_flag(a0, a1) result
                else:
                    regs2[2] = regs2[3] = None                     # clobber $v0/$v1
                idx, regs, a0, a1 = idx + 2, regs2, a0d, a1d
                continue

            if k == "jal":
                a0d, a1d = apply_args(ws[idx + 1], regs, a0, a1)
                regs2 = dict(regs); apply_regs(ws[idx + 1], regs2)
                regs2[2] = regs2[3] = None
                idx, regs, a0, a1 = idx + 2, regs2, a0d, a1d
                continue

            if k == "jr":
                return

            a0, a1 = apply_args(w, regs, a0, a1)
            apply_regs(w, regs)
            idx += 1

    run(entry, {}, None, None, [], frozenset())
    return results


def extract_stage(stage_num):
    path = ASM_DIR / f"wstag{stage_num}.s"
    if not path.exists():
        return {}
    ws = words_of(path)
    funcs = find_functions(ws)
    out = {}
    for i, w in enumerate(ws):
        if w != JAL_START_EVENT:
            continue
        fn = next((f for f in funcs if f[0] <= i < f[1]), None)
        if not fn:
            continue
        for ev, csets in trace_call(ws, fn[0], fn[1], i).items():
            # strip redundant ordinal-INequalities (ord!=M is implied by the path's ord==N), then
            # collapse identical paths (same constraint set, order-independent).
            def clean(cs):
                pos = {fid for fid, exp in cs if (fid & 0xFF00) == 0x6000 and exp == 1}
                return frozenset((fid, exp) for fid, exp in cs
                                 if not ((fid & 0xFF00) == 0x6000 and exp == 0 and pos))
            distinct = {clean(cs) for cs in csets}
            if len(distinct) != 1:                # genuinely different paths → disjunction → skip
                continue
            conds = list(distinct.pop())
            pos_ords = {fid for fid, exp in conds if (fid & 0xFF00) == 0x6000 and exp == 1}
            if len(pos_ords) != 1:                 # exactly one ordinal beat (no contradiction, not ungated)
                continue
            # stable order: ordinal first, then flags by id
            conds.sort(key=lambda c: (0 if (c[0] & 0xFF00) == 0x6000 else 1, c[0], c[1]))
            out.setdefault(str(ev), {})["conds"] = [[fid, exp] for fid, exp in conds]
    return out


def main():
    gates = {}
    for p in sorted(ASM_DIR.glob("wstag*.s")):
        stage = int(p.stem.replace("wstag", ""))
        g = extract_stage(stage)
        if g:
            gates[f"s{stage}"] = g
    OUT.write_text(json.dumps(gates, indent=2) + "\n")
    total = sum(len(v) for v in gates.values())
    print(f"Wrote {OUT}")
    print(f"{len(gates)} stages, {total} gated events")
    for s, g in sorted(gates.items()):
        for ev, info in sorted(g.items(), key=lambda kv: int(kv[0])):
            pretty = ", ".join(
                (f"ord=={fid & 0xff}" if (fid & 0xFF00) == 0x6000 else f"flag {hex(fid)}=={exp}")
                for fid, exp in info["conds"])
            print(f"  {s} event {ev}: {pretty}")


if __name__ == "__main__":
    main()
