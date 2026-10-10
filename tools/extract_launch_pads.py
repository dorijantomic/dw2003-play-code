#!/usr/bin/env python3
"""Extract the per-stage type-0x17 launch-pad objects to walker assets.

System decoded 2026-07-28 (see docs/research/field/launch-pad-actor-decoded.md).

A launch pad is a native actor a stage overlay builds for itself -- it is NOT a
fieldstg system, which is why every generic field extractor missed it. Ten
stage overlays contain the same shape:

    lui   $v0, 0x800a
    addiu $s0, $v0, TABLE          # 12-byte records
  loop:
    lh    $v0, 2($s0)              # nonzero -> this slot is skipped
    bnez  $v0, next
    lw    $a0, 4($s0)              # x
    lw    $a1, 8($s0)              # y
    lh    $a2, 0($s0)              # base clip id
    jal   pad_ctor                 # -> F0x800143dc(cb, 0x6c, 0, id=0x17)
    ...
    addiu $s0, $s0, 0xc            # stride
    slti  $v0, $s2, COUNT          # slot count

`pad_ctor` stores x/y/clip into obj+0x54/+0x58/+0x50; the object's own callback
copies them to obj+0x4/+0x8 on its first tick, which is what the fieldstg op-13
transition controller (F0x8008c130) reads when it looks for "the nearest
type-0x17 object". So these records ARE the pad positions the launch sequence
homes in on.

The same callback also runs TWO animator scripts (decoded 2026-07-28, see
docs/research/field/launch-pad-actor-decoded.md §3a):

  * the IDLE script (looping, oneShot=0) writes obj+0x66, which the pad's draw
    hands to the draw context's CLUT method (EXE F0x8001ecec -> ctx+0x20, added
    to the CLUT row in F0x8001ed6c). Its value is therefore a PALETTE ROW
    OFFSET on the pad's floor disc, not a clip id -- this is the colour pulse
    an untouched pad shows from the moment the stage loads;
  * the STROBE script (one-shot, oneShot=1) writes obj+0x68 = clipBase + value,
    the light column drawn during a launch.

Output: web/assets/data/launch_pads.json

    { "735": { "pads": [ {"x":444, "y":652, "clip":28, "slot":3}, ... ],
                "table": "0x800a67dc", "stride": 12, "slots": 10,
                "callback": "0x800a620c",
                "idleScript":   {"addr": "0x800a6854", "entries": [[0,6], ...]},
                "strobeScript": {"addr": "0x800a686c", "entries": [[300,18], ...]}
              }, ... }

Records whose guard halfword is nonzero are still emitted, with "enabled":
false, so the guard semantics stay visible rather than being silently dropped
(s311 accepts guard 0 *or* 2 -- its extra gate is not decoded here).

Fail-soft: a stage whose loop does not parse is reported and skipped; the tool
always exits 0 so build_all never blocks on one overlay.
"""

import os
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs

WSTAG_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/launch_pads.json"

BASE = 0x800A5DE0
ALLOC = 0x0C000000 | ((0x800143DC >> 2) & 0x3FFFFFF)
PAD_TYPE = 0x17
LI_A3_PAD = 0x24070000 | PAD_TYPE  # addiu $a3, $zero, 0x17
JR_RA = 0x03E00008
SCRIPT_END = 0xFF  # animator script terminator value

# Back/forward instruction windows around the ctor call. The ten known sites
# all fit in (20 back, 16 forward); the bounds are asserted, not assumed.
BACK, FWD = 20, 16


def _s16(v):
    return v - 0x10000 if v & 0x8000 else v


def _op(w):
    return w >> 26


def _rs(w):
    return (w >> 21) & 31


def _rt(w):
    return (w >> 16) & 31


def _imm(w):
    return _s16(w & 0xFFFF)


def pad_ctor(words):
    """File offset of the stage's type-0x17 constructor, or None."""
    for off, w in words.items():
        if w == ALLOC and words.get(off + 4) == LI_A3_PAD:
            j = off
            while j > 0 and words.get(j) != JR_RA:
                j -= 4
            if j <= 0:
                return None
            return j + 8  # skip the jr's delay slot
    return None


def pad_callback(words, ctor):
    """RAM address of the pad object's own per-frame callback (the ctor's $a0)."""
    site = None
    for o in range(ctor, ctor + 0x100, 4):
        if words.get(o) == ALLOC:
            site = o
            break
    if site is None:
        return None
    hi, cb = {}, None
    for o in range(ctor, site + 8, 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x0F:  # lui
            hi[_rt(w)] = (w & 0xFFFF) << 16
        elif _op(w) == 0x09 and _rt(w) == 4 and _rs(w) in hi:  # addiu $a0, rX, lo
            cb = hi[_rs(w)] + _imm(w)
    return cb


def pad_scripts(words, cb):
    """(idle, strobe) script RAM addresses driven by the pad callback.

    The callback runs the stage's generic 4-byte-entry animator
    `anim(cursor, script, oneShot, depth)` (wstag735 F0x800a5f40). Its state-1
    branch calls it with oneShot=0 on the IDLE script; state 2 calls it again on
    the idle script and then once more with oneShot=1 on the STROBE script.
    Discriminating on the oneShot argument rather than on call order is what
    keeps this stage-agnostic. Verified identical in shape across all ten
    launch-pad overlays.
    """
    off = cb - BASE
    end = off
    while words.get(end) != JR_RA and end < off + 0x1000:
        end += 4
    hi, a1, a2 = {}, None, None
    found = {}
    for o in range(off, end + 8, 4):
        w = words.get(o)
        if w is None:
            continue
        op = _op(w)
        if op == 0x0F:  # lui
            hi[_rt(w)] = (w & 0xFFFF) << 16
        elif op == 0x09:  # addiu rt, rs, imm
            val = (hi.get(_rs(w), 0) if _rs(w) else 0) + _imm(w)
            if _rt(w) == 5:
                a1 = val
            elif _rt(w) == 6:
                a2 = val
        elif op == 0 and (w & 0x3F) == 0x21 and _rs(w) == 0 and _rt(w) == 0:
            if ((w >> 11) & 31) == 6:  # move $a2, $zero
                a2 = 0
            elif ((w >> 11) & 31) == 5:
                a1 = 0
        elif op == 3 and a1 is not None and a1 >= BASE and a2 in (0, 1):
            found.setdefault("idle" if a2 == 0 else "strobe", a1)
    return found.get("idle"), found.get("strobe")


def read_script(words, ram, limit=64):
    """Decode an animator script: 4-byte `{s16 value, u16 holdTicks}` entries,
    terminated by (and including) the 0xff entry."""
    if ram is None:
        return None
    out, o = [], ram - BASE
    for _ in range(limit):
        w = words.get(o)
        if w is None:
            return None
        out.append([_s16(w & 0xFFFF), w >> 16])
        o += 4
        if (w & 0xFFFF) == SCRIPT_END:
            return out
    return None


def parse_loop(words, site):
    """Recover (table_ram, stride, slots, offsets) for one ctor call site."""
    back = [words.get(site - 4 * k) for k in range(BACK, 0, -1)]
    fwd = [words.get(site + 4 * k) for k in range(1, FWD + 1)]

    # Table base: lui rX, hi   then   addiu rY, rX, lo
    table = reg = None
    hi = {}
    for w in back:
        if w is None:
            continue
        if _op(w) == 0x0F:  # lui
            hi[_rt(w)] = (w & 0xFFFF) << 16
        elif _op(w) == 0x09 and _rs(w) in hi:  # addiu rt, rs, imm
            table, reg = hi[_rs(w)] + _imm(w), _rt(w)
    if table is None:
        return None

    # Field offsets: the loads into $a0/$a1/$a2 based on the table register.
    # $a2 may be loaded through the lui register instead (s750), in which case
    # the offset is absolute and normalised back against the table base.
    off = {}
    for w in back:
        if w is None or _op(w) not in (0x20, 0x21, 0x23, 0x24, 0x25):
            continue  # lb/lh/lw/lbu/lhu only
        if _rt(w) not in (4, 5, 6):  # $a0,$a1,$a2
            continue
        if _rs(w) == reg:
            off[_rt(w)] = _imm(w)
        elif _rs(w) in hi:
            off[_rt(w)] = hi[_rs(w)] + _imm(w) - table
    if set(off) != {4, 5, 6}:
        return None

    # Guard: the halfword load the spawn branches on -- read off the table
    # register, at an offset distinct from the three field loads.
    guard = guard_reg = None
    for k, w in enumerate(back):
        if w is None or _op(w) not in (0x21, 0x25) or _rs(w) != reg:
            continue
        if _imm(w) not in off.values():
            guard, guard_reg, guard_at = _imm(w), _rt(w), k

    # Which guard values actually spawn a pad. Two shapes occur:
    #   bnez rG, skip                          -> {0}
    #   beqz rG, ok ; li rC, N ; bne rG, rC, skip -> {0, N}
    accepts = [0]
    if guard_reg is not None:
        consts = {}
        for w in back[guard_at + 1 : guard_at + 6]:
            if w is None:
                continue
            if _op(w) == 0x09 and _rs(w) == 0:  # li rC, N
                consts[_rt(w)] = _imm(w)
            elif _op(w) == 0x05 and _rs(w) == guard_reg and _rt(w) == 0:
                break  # bnez guard -> skip: only 0 spawns
            elif _op(w) == 0x05 and guard_reg in (_rs(w), _rt(w)):
                other = _rt(w) if _rs(w) == guard_reg else _rs(w)
                if other in consts:
                    accepts.append(consts[other])  # bne guard, N -> skip
                break

    stride = slots = None
    for w in fwd:
        if w is None:
            continue
        if _op(w) == 0x09 and _rs(w) == reg and _rt(w) == reg:  # addiu rY,rY,S
            stride = _imm(w)
        elif _op(w) == 0x0A:  # slti rt, rs, N
            slots = _imm(w)
    if stride is None and slots is None:
        # Unrolled single spawn (s750): no loop, one record, size implied by
        # the field offsets the code actually reads.
        stride, slots = max(off.values()) + 4, 1
    if not stride or not slots:
        return None

    return {
        "table": table,
        "stride": stride,
        "slots": slots,
        "x": off[4],
        "y": off[5],
        "clip": off[6],
        "guard": guard,
        "accepts": sorted(accepts),
    }


def read_pads(words, loop):
    """Decode the stage's pad records straight out of the overlay image."""
    start = loop["table"] - BASE
    pads = []
    for i in range(loop["slots"]):
        rec = start + i * loop["stride"]

        def half(o):
            w = words.get(rec + (o & ~3))
            if w is None:
                return None
            return _s16((w >> (16 * ((o & 2) >> 1))) & 0xFFFF)

        def word(o):
            return words.get(rec + o)

        guard = half(loop["guard"]) if loop["guard"] is not None else 0
        if guard is None:
            return None
        if guard not in loop["accepts"]:
            # The overlay never spawns this slot, so the rest of the record is
            # not pad data (past the last table entry it is the next blob
            # entirely). Emit the guard only rather than nonsense coordinates.
            pads.append({"slot": i, "guard": guard, "enabled": False})
            continue
        x, y = word(loop["x"]), word(loop["y"])
        clip = half(loop["clip"])
        if x is None or y is None or clip is None:
            return None
        pads.append(
            {
                "slot": i,
                "x": x,
                "y": y,
                "clip": clip,
                "guard": guard,
                "enabled": True,
            }
        )
    return pads


def extract(stage):
    path = WSTAG_DIR / f"wstag{stage}.s"
    if not path.exists():
        return None
    words = ovs.load_words(path)
    ctor = pad_ctor(words)
    if ctor is None:
        return None
    call = 0x0C000000 | (((BASE + ctor) >> 2) & 0x3FFFFFF)
    sites = [o for o in sorted(words) if words[o] == call]
    if len(sites) != 1:
        raise ValueError(f"s{stage}: expected 1 pad-spawn site, found {len(sites)}")
    loop = parse_loop(words, sites[0])
    if loop is None:
        raise ValueError(f"s{stage}: pad spawn loop did not parse")
    pads = read_pads(words, loop)
    if pads is None:
        raise ValueError(f"s{stage}: pad table runs past the overlay image")
    entry = {
        "ctor": f"0x{BASE + ctor:08x}",
        "table": f"0x{loop['table']:08x}",
        "stride": loop["stride"],
        "slots": loop["slots"],
        "guardAccepts": loop["accepts"],
        "pads": pads,
    }
    cb = pad_callback(words, ctor)
    if cb is not None:
        entry["callback"] = f"0x{cb:08x}"
        idle_at, strobe_at = pad_scripts(words, cb)
        idle, strobe = read_script(words, idle_at), read_script(words, strobe_at)
        # The idle script is what makes an untouched pad pulse: its value is a
        # CLUT-ROW OFFSET, not a clip id (see the module docstring).
        if idle:
            entry["idleScript"] = {"addr": f"0x{idle_at:08x}", "entries": idle}
        if strobe:
            entry["strobeScript"] = {"addr": f"0x{strobe_at:08x}", "entries": strobe}
    return entry


def main():
    out, skipped = {}, []
    for path in sorted(WSTAG_DIR.glob("wstag*.s")):
        stage = path.stem[len("wstag") :]
        try:
            got = extract(stage)
        except ValueError as exc:  # fail-soft: report, keep going
            skipped.append(str(exc))
            continue
        if got:
            out[stage] = got

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")

    total = sum(len(v["pads"]) for v in out.values())
    live = sum(sum(1 for p in v["pads"] if p["enabled"]) for v in out.values())
    print(f"launch pads: {len(out)} stages, {total} slots, {live} enabled -> {OUT}")
    for line in skipped:
        print(f"  skipped: {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
