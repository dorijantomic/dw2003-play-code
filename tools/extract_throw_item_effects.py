#!/usr/bin/env python3
"""Extract the battle item machine's THROW-BAND typed arms (items 77-90) into web assets.

The item machine FIGHTSTG_F0x8008d3b4 (pro/fightstg.s:10676) runs the item-use action.
Its state-0 dispatch reads the used item's id from ctx+0x70 and:

  * ids 77..90  -> the 14-word jump table at 0x80082ee4 (.L0x8008d408-.L0x8008d430,
                   table at fightstg.s:131-144) -> the TYPED arms decoded here;
  * every other -> the default arm .L0x8008d8e0 (clip 10 + the 0x800a336c table; see
                   tools/extract_item_use_effects.py).

Every arm allocates a fresh presentation actor (FIGHTSTG_F0x8008c910) and writes four
actor fields (offsets on the fresh actor):

  +0x54 = the action CLIP to run
  +0x68 = the MOTION id (read by the clip's op4 sentinel 0x38; -1 = skip)
  +0x6c = the EFFECT type (op3's 9999 sentinel resolves it)
  +0x70 = the SOUND type (op10's 99 strike reads it; F0x8009b774 plays op10 sound table)

The eight distinct arms (fightstg.s line numbers in parentheses):

  77-83  .L0x8008d434 (10709)  clip 15, motion 0x22+3*(id-77) = 34,37,..,52, effect 2, sound 0x39
  84     .L0x8008d44c (10715)  clip 15, motion 0x22+3*(rand_u16()%7) (the magic 0x92492493
                               divides by 7), effect 2, sound 0x39
  85     .L0x8008d714 (10893)  clip 14, motion -1, effect 0x1c, sound 0x27
  86     .L0x8008d4dc (10751)  clip 17, motion -1, effect 0x15, sound 0x1b
  87     .L0x8008d510 (10764)  clip 17, motion -1, effect 0x27, sound 0x31
  88     .L0x8008d52c (10771)  clip 17, motion -1, effect/sound by ctx+0x7c (the STR/DEF
                               branch its own producer sets): 1 -> 0x25/0x31, 2 -> 0x27/0x31,
                               else -> 0x2e/0x1e
  89     .L0x8008d550 (10780)  clip 17, motion -1, effect 0x29, sound 0x31
  90     .L0x8008d7e8 (10946)  clip 14, motion/effect/sound = bytes at resident 0x80043579/
                               0x8004357a/0x8004357b (base 0x8004356c + 0xd/e/f)

Item 90's three bytes are read from the resident PS-X EXE image (web/assets/native/
screens/resident.bin, base 0x80010000): 0x21 (33), 0x04 (4), 0x19 (25).

Also decoded here (the state-1 fallback, fightstg.s:11082-11127): item 85 alone re-runs
the machine with no actor yet and, when ctx+0x18 == 0 and the gate byte 0x80042b5f == 0,
allocates a SECOND actor with clip 10, effect 0x21, sound 0x1f. Recorded in the JSON as
`state1_fallback` for the port's reference; the clip-band records above are the state-0
writes the walker plays.

Derivation is from the assembly (authority) with every constant cross-checked against the
raw overlay bytes (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0) — a
mismatch is a hard error. The census is re-asserted by tests/throw-item-effect.test.js.

Usage: tools/extract_throw_item_effects.py [--check]
"""
import argparse
import json
import os
import re
import struct
import sys
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/throw_item_effects.json"
FIGHTSTG = DDW3 / "asm/dw2003/pro/fightstg.s"
BIN = REPO / "web/assets/native/screens/pro_fightstg.bin"
RESIDENT = REPO / "web/assets/native/screens/resident.bin"

FIGHTSTG_BASE = 0x80082CB0       # pro/fightstg.s:3 .section "section_FIGHTSTG_00.0x80082cb0"
RESIDENT_BASE = 0x80010000       # tools/extract_jogress_scripts.py RESIDENT_BASE

BAND = (77, 90)
TABLE_BASE = 0x80082EE4          # 14 words, indexed by id - 77
TAIL = 0x8008D9B0                # the common state-advance tail every arm reaches

INSN_RE = re.compile(r"^\.L0x([0-9a-f]{8}):\s+(\S+)\s*(.*)$")
WORD_RE = re.compile(r"^\.L0x(800[0-9a-f]{5}):\s+\.word\s+(0x[0-9a-fA-F]+)")


class DecodeError(SystemExit):
    pass


def load_asm(path: Path):
    """RAM address -> (mnemonic, operand text) for instruction lines; .word labels too."""
    insn: dict[int, tuple[str, str]] = {}
    words: dict[int, int] = {}
    for line in path.read_text().splitlines():
        m = INSN_RE.match(line)
        if m:
            addr = int(m.group(1), 16)
            mnem = m.group(2)
            if mnem == ".word":
                try:
                    words[addr] = int(m.group(3).split()[0], 16)
                except ValueError:
                    pass
            else:
                insn[addr] = (mnem, m.group(3).split("#")[0].strip())
        else:
            m = WORD_RE.match(line)
            if m:
                words[int(m.group(1), 16)] = int(m.group(2), 16)
    return insn, words


def bin_word(blob: bytes, addr: int) -> int:
    return struct.unpack_from("<I", blob, addr - FIGHTSTG_BASE)[0]


def expect(insn, addr, mnem, ops=None):
    if addr not in insn:
        raise DecodeError(f"expected an instruction at 0x{addr:08x}")
    m, o = insn[addr]
    if m != mnem or (ops is not None and o != ops):
        raise DecodeError(f"0x{addr:08x}: expected `{mnem} {ops or ''}`, found `{m} {o}`")
    return o


def li_imm(ops: str) -> int:
    """`li $v0, 0x1c` / `li $v0, -0x1` -> int."""
    parts = ops.replace(",", " ").split()
    if len(parts) != 2 or parts[0] != "$v0":
        raise DecodeError(f"not a `li $v0, IMM`: {ops!r}")
    return int(parts[1], 16)


def sw_off(ops: str) -> tuple[str, int]:
    """`$v0, 0x54($v1)` -> ('$v1', 0x54)."""
    m = re.match(r"^\$v0,\s*(0x[0-9a-f]+)\((\$\w+)\)$", ops.replace(" ", ""))
    if not m:
        raise DecodeError(f"not a `sw $v0, OFF($reg)`: {ops!r}")
    return m.group(2), int(m.group(1), 16)


def walk(insn, start: int, stop: int = TAIL, stop_fields: set | None = None):
    """Follow an arm's straight-line code, chasing `j` jumps, until `stop` or until every
    field in `stop_fields` has been written. Conditional branches raise (the arm's shape
    changed); jal/jalr calls are stepped over. Returns the ordered (addr, mnem, ops) list."""
    out, addr, seen = [], start, set()
    collected: set[int] = set()
    while addr != stop:
        if addr in seen:
            raise DecodeError(f"loop at 0x{addr:08x}")
        seen.add(addr)
        if addr not in insn:
            raise DecodeError(f"no instruction at 0x{addr:08x}")
        m, o = insn[addr]
        out.append((addr, m, o))
        if m == "j":
            target = int(re.match(r"^\.L0x([0-9a-f]+)$", o).group(1), 16)
            if addr + 4 in insn:                     # the delay slot executes too
                out.append((addr + 4, *insn[addr + 4]))
                if insn[addr + 4][0] == "sw" and insn[addr + 4][1].startswith("$v0,"):
                    collected.add(sw_off(insn[addr + 4][1])[1])
            if stop_fields and stop_fields <= collected:
                break
            addr = target
            continue
        if m in ("beq", "bne", "beqz", "bnez", "b", "bgtz", "blez", "bltz", "jr"):
            raise DecodeError(f"0x{addr:08x}: unexpected branch `{m} {o}` in the arm walk")
        if m == "sw" and o.startswith("$v0,"):
            collected.add(sw_off(o)[1])
            if stop_fields and stop_fields <= collected:
                break
        addr += 4
    return out


def collect_fields(steps):
    """Ordered (li $v0, IMM) + (sw $v0, OFF) pairs -> {field: (value, li_addr, sw_addr)}."""
    fields, pending = {}, None
    for addr, m, o in steps:
        if m in ("li", "ori") and o.startswith("$v0,"):
            try:
                pending = (addr, li_imm(o))
            except DecodeError:
                pending = None
        elif m == "sw" and o.startswith("$v0,"):
            if pending is not None:
                _, off = sw_off(o)
                fields.setdefault(off, (pending[1], pending[0], addr))
                pending = None
    return fields


def arm_records(insn, words, blob, resident):
    table = [words[TABLE_BASE + 4 * i] for i in range(BAND[1] - BAND[0] + 1)]
    expected = [0x8008D434] * 7 + [0x8008D44C, 0x8008D714, 0x8008D4DC, 0x8008D510,
                                  0x8008D550, 0x8008D52C, 0x8008D7E8]
    if table != expected:
        raise DecodeError(f"jump table at 0x{TABLE_BASE:08x} changed: {[hex(t) for t in table]}")
    for i, target in enumerate(table):               # cross-check vs the raw overlay bytes
        if bin_word(blob, TABLE_BASE + 4 * i) != target:
            raise DecodeError(f"jump table word {i} differs between .s and bin")

    records = []

    # ── arm 77-83: clip 15, motion 0x22+3*(id-77), effect 2, sound 0x39 ────────────────
    f = collect_fields(walk(insn, 0x8008D434, stop_fields={0x54, 0x6C, 0x70}))
    if (f.get(0x54, (None,))[0], f.get(0x68, (None,))[0], f.get(0x6C, (None,))[0],
            f.get(0x70, (None,))[0]) != (0xF, None, 2, 0x39):
        raise DecodeError(f"arm 77-83 shape changed: {f}")
    expect(insn, 0x8008D448, "addiu", "$v0, -0x4d")          # item id - 77
    expect(insn, 0x8008D4AC, "sll", "$v1, $v0, 0x1")
    expect(insn, 0x8008D4B0, "addu", "$v1, $v0")             # v1 = 3*(id-77)
    expect(insn, 0x8008D4B8, "addiu", "$v1, 0x22")           # + 0x22
    expect(insn, 0x8008D4BC, "sw", "$v1, 0x68($v0)")
    for item in range(77, 84):
        records.append({"item": item, "clip": 0xF, "motion": 0x22 + 3 * (item - 77),
                        "effect": 2, "sound": 0x39})

    # ── arm 84: clip 15, motion 0x22+3*(rand_u16()%7), effect 2, sound 0x39 ───────────
    f = collect_fields(walk(insn, 0x8008D44C, stop_fields={0x54, 0x6C, 0x70}))
    if (f.get(0x54, (None,))[0], f.get(0x6C, (None,))[0], f.get(0x70, (None,))[0]) != (0xF, 2, 0x39):
        raise DecodeError(f"arm 84 shape changed: {f}")
    expect(insn, 0x8008D44C, "lui", "$v0, 0x8005")
    expect(insn, 0x8008D450, "lw", "$v0, -0x23f4($v0)")      # rand_u16 (fn ptr 0x8004dc0c)
    expect(insn, 0x8008D454, "nop")
    expect(insn, 0x8008D458, "jalr", "$v0")                  # rand_u16 (fn ptr 0x8004dc0c)
    expect(insn, 0x8008D460, "lui", "$v1, 0x9249")
    expect(insn, 0x8008D464, "ori", "$v1, 0x2493")           # the /7 signed-division magic
    expect(insn, 0x8008D48C, "addiu", "$v0, 0x2")
    expect(insn, 0x8008D490, "sw", "$v0, 0x74($s2)")
    expect(insn, 0x8008D4A8, "addiu", "$v0, -0x2")
    records.append({"item": 84, "clip": 0xF, "motion": None,
                    "motion_random": {"base": 0x22, "step": 3, "count": 7},
                    "effect": 2, "sound": 0x39})

    # ── arm 85: clip 14, motion -1, effect 0x1c, sound 0x27 ───────────────────────────
    f = collect_fields(walk(insn, 0x8008D714, stop_fields={0x54, 0x68, 0x6C, 0x70}))
    if (f.get(0x54, (None,))[0], f.get(0x68, (None,))[0], f.get(0x6C, (None,))[0],
            f.get(0x70, (None,))[0]) != (0xE, -1, 0x1C, 0x27):
        raise DecodeError(f"arm 85 shape changed: {f}")
    records.append({"item": 85, "clip": 0xE, "motion": -1, "effect": 0x1C, "sound": 0x27})

    # ── arm 86: clip 17, motion -1, effect 0x15, sound 0x1b ───────────────────────────
    f = collect_fields(walk(insn, 0x8008D4DC, stop_fields={0x54, 0x68, 0x6C, 0x70}))
    if (f.get(0x54, (None,))[0], f.get(0x68, (None,))[0], f.get(0x6C, (None,))[0],
            f.get(0x70, (None,))[0]) != (0x11, -1, 0x15, 0x1B):
        raise DecodeError(f"arm 86 shape changed: {f}")
    records.append({"item": 86, "clip": 0x11, "motion": -1, "effect": 0x15, "sound": 0x1B})

    # ── arm 87: clip 17, motion -1, effect 0x27, sound 0x31 (tail at 0x8008d6dc) ──────
    f = collect_fields(walk(insn, 0x8008D510, stop_fields={0x54, 0x68, 0x6C, 0x70}))
    if (f.get(0x54, (None,))[0], f.get(0x68, (None,))[0], f.get(0x6C, (None,))[0],
            f.get(0x70, (None,))[0]) != (0x11, -1, 0x27, 0x31):
        raise DecodeError(f"arm 87 shape changed: {f}")
    records.append({"item": 87, "clip": 0x11, "motion": -1, "effect": 0x27, "sound": 0x31})

    # ── arm 89: clip 17, motion -1, effect 0x29, sound 0x31 (arm at 0x8008d52c) ───────
    f = collect_fields(walk(insn, 0x8008D52C, stop_fields={0x54, 0x68, 0x6C, 0x70}))
    if (f.get(0x54, (None,))[0], f.get(0x68, (None,))[0], f.get(0x6C, (None,))[0],
            f.get(0x70, (None,))[0]) != (0x11, -1, 0x29, 0x31):
        raise DecodeError(f"arm 89 shape changed: {f}")
    records.append({"item": 89, "clip": 0x11, "motion": -1, "effect": 0x29, "sound": 0x31})

    # ── arm 88: clip 17, motion -1, effect/sound by ctx+0x7c (1 / 2 / else) ───────────
    # The arm at 0x8008d550 is the CursedPuppet producer (d550-d69c, decoded in
    # engine/dw3/battle-items.ts) and falls through into the shared tail at 0x8008d6a0,
    # where the clip/motion and the ctx+0x7c flag dispatch live.
    expect(insn, 0x8008D550, "li", "$a0, 0x10")
    expect(insn, 0x8008D558, "addiu", "$v1, 0x4460")
    expect(insn, 0x8008D5B8, "lh", "$v0, 0x10($s1)")        # the STR/DEF compare (base record)
    expect(insn, 0x8008D6A0, "lw", "$v1, ($s0)")
    f = collect_fields(walk(insn, 0x8008D6A0, stop_fields={0x54, 0x68}))
    if (f.get(0x54, (None,))[0], f.get(0x68, (None,))[0]) != (0x11, -1):
        raise DecodeError(f"arm 88 shape changed: {f}")
    expect(insn, 0x8008D6B8, "lw", "$v1, 0x7c($s2)")        # the STR/DEF branch flag
    expect(insn, 0x8008D6BC, "li", "$v0, 0x1")
    expect(insn, 0x8008D6C0, "bne", "$v1, $v0, .L0x8008d6d4")
    expect(insn, 0x8008D6D0, "li", "$v0, 0x25")             # flag 1 -> effect 0x25
    expect(insn, 0x8008D6D4, "bne", "$v1, $v0, .L0x8008d6f8")
    expect(insn, 0x8008D6E0, "li", "$v0, 0x27")             # flag 2 -> effect 0x27
    expect(insn, 0x8008D6E4, "sw", "$v0, 0x6c($v1)")
    expect(insn, 0x8008D6EC, "li", "$v0, 0x31")             # sound for flags 1 and 2
    expect(insn, 0x8008D6F4, "sw", "$v0, 0x70($v1)")
    expect(insn, 0x8008D6D8, "li", "$v0, 0x2e")             # else -> effect 0x2e
    expect(insn, 0x8008D700, "sw", "$v0, 0x6c($v1)")
    expect(insn, 0x8008D708, "li", "$v0, 0x1e")             # else -> sound 0x1e
    expect(insn, 0x8008D710, "sw", "$v0, 0x70($v1)")
    records.append({"item": 88, "clip": 0x11, "motion": -1, "effect": 0x2E, "sound": 0x1E,
                    "effect_branch": {"str": 0x25, "def": 0x27, "none": 0x2E},
                    "sound_branch": {"str": 0x31, "def": 0x31, "none": 0x1E}})

    # ── arm 90: clip 14, motion/effect/sound = resident bytes at 0x8004356c+0xd/e/f ───
    f = collect_fields(walk(insn, 0x8008D7E8, stop_fields={0x54}))
    if f.get(0x54, (None,))[0] != 0xE:
        raise DecodeError(f"arm 90 shape changed: {f}")
    expect(insn, 0x8008D7F4, "lui", "$v1, 0x8004")
    expect(insn, 0x8008D7F8, "addiu", "$v1, 0x356c")
    for addr, off in ((0x8008D800, 0xD), (0x8008D810, 0xE), (0x8008D820, 0xF)):
        expect(insn, addr, "lbu", f"$v0, 0x{off:x}($v1)")
    expect(insn, 0x8008D808, "sw", "$v0, 0x68($a0)")
    expect(insn, 0x8008D818, "sw", "$v0, 0x6c($a0)")
    expect(insn, 0x8008D828, "sw", "$v0, 0x70($a1)")
    base = 0x8004356C
    motion = resident[base + 0xD - RESIDENT_BASE]
    effect = resident[base + 0xE - RESIDENT_BASE]
    sound = resident[base + 0xF - RESIDENT_BASE]
    records.append({"item": 90, "clip": 0xE, "motion": motion, "effect": effect, "sound": sound})

    # item 85's state-1 fallback arm (fightstg.s:11082-11127)
    expect(insn, 0x8008DA18, "lw", "$v1, 0x70($s2)")
    expect(insn, 0x8008DA1C, "li", "$v0, 0x55")
    expect(insn, 0x8008DA38, "lui", "$v0, 0x8004")
    expect(insn, 0x8008DA3C, "lbu", "$v0, 0x2b5f($v0)")
    expect(insn, 0x8008DA60, "li", "$v0, 0xa")
    expect(insn, 0x8008DA6C, "li", "$v0, 0x21")
    expect(insn, 0x8008DA78, "li", "$v0, 0x1f")
    fallback = {"item": 85, "clip": 0xA, "effect": 0x21, "sound": 0x1F,
                "when": "actor == null && ctx+0x18 == 0 && byte[0x80042b5f] == 0"}

    return table, records, fallback


def build() -> dict:
    if not FIGHTSTG.exists():
        raise DecodeError(f"{FIGHTSTG} is not present; the extractor reads the assembly")
    insn, words = load_asm(FIGHTSTG)
    blob = BIN.read_bytes()
    resident = RESIDENT.read_bytes()
    table, records, fallback = arm_records(insn, words, blob, resident)

    records.sort(key=lambda r: r["item"])
    items = [r["item"] for r in records]
    if items != list(range(BAND[0], BAND[1] + 1)):
        raise DecodeError(f"records must cover {BAND[0]}..{BAND[1]}: {items}")
    for r in records:
        if not (1 <= r["clip"] < 0x20):
            raise DecodeError(f"item {r['item']}: clip out of range")
        if r["effect"] is not None and not (1 <= r["effect"] < 100):
            raise DecodeError(f"item {r['item']}: effect out of range")
        if not (1 <= r["sound"] < 100):
            raise DecodeError(f"item {r['item']}: sound out of range")
        if r["motion"] is not None and r["motion"] != -1 and not (1 <= r["motion"] < 0x38):
            raise DecodeError(f"item {r['item']}: motion out of range")

    return {
        "source": "asm/dw2003/pro/fightstg.s F0x8008d3b4 state-0 typed arms "
                  "(fightstg, RAM base 0x80082cb0; resident base 0x80010000)",
        "band": list(BAND),
        "jump_table": f"0x{TABLE_BASE:x}",
        "jump_targets": [f"0x{t:x}" for t in table],
        "records": records,
        "state1_fallback": fallback,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail if the output is stale")
    args = ap.parse_args()

    data = build()
    text = json.dumps(data, indent=1) + "\n"

    if args.check:
        try:
            if json.loads(OUT.read_text()) != data:
                print("extract_throw_item_effects: throw_item_effects.json is stale", file=sys.stderr)
                return 1
        except OSError:
            print("extract_throw_item_effects: throw_item_effects.json missing", file=sys.stderr)
            return 1
        print("extract_throw_item_effects: up to date")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"throw item effects: wrote {OUT.name} ({len(data['records'])} records)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
