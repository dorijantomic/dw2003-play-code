#!/usr/bin/env python3
"""Street-lighting tables: the six traffic-light glow sprites and the two lamp
sequences the Kusanagi City street corner (wstag780) drives for itself.

Three objects in the overlay share this data, and each is found BY ITS OWN CODE
so the membership census below is a fact about the 294 stage overlays rather
than a hand list:

  * the traffic-light writer (tick 0x800a67a4, wstag780 file 0x9c4) — the
    routine that walks the stage's 18-byte point records looking for the two
    whose byte+1 is 1 and 2, then writes active/sprite/ctr into them every
    frame from a lamp sequence. Signature: the four `sh/sb` stores of the
    state-0 arm and the 0x12-byte record stride.
  * the lamp/glow object (tick 0x800a652c, file 0x74c) — six of them, one per
    record of an 8-byte table; each draws a two-frame clip at a fixed (x, y).
    The table address is materialised as `lui 0x800b` + `addiu -0x7be0`
    (0x800A8420) at file 0x79c and 0x844.
  * the lamp sequence pointer table at 0x800A8518 (`lui 0x800b` +
    `addiu -0x7ae8`, file 0xa14/0xa20 and 0xac4/0xac8): two pointers, each to
    a list of {sprite id, hold} halfword pairs ending at a 0xff entry.

The list format and the 0xff loop marker are the ones both sequence players in
the overlay use (0x800a638c for the lamps, 0x800a66b0 for the writer).

Usage:
  python3 tools/extract_street_lights.py            # compare (default)
  python3 tools/extract_street_lights.py --write    # regenerate
  python3 tools/extract_street_lights.py --census   # membership only
"""

from __future__ import annotations

import re
import struct
import sys
from pathlib import Path

ASM = Path.home() / "ddw3/asm/dw2003/pro"
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "engine/dw3/street-light-tables.ts"

OVERLAY_BASE = 0x800A5DE0
# `lui $r, 0x800b` is how every address in this overlay's own data is built.
HI = 0x800B0000

# The writer's state-0 arm, opcode+registers only (immediates masked off):
#   sh $zero, 0x54($s5)   file 0xa10
#   lw $a0, -0x6270($v0)  file 0xa44   [0x800a9d90] = the stage's record table
#   addiu $v1, 0x12       file 0xa7c   the 18-byte record stride
#   sb $s6, ($s0)         file 0xaec   rec.active = 1
#   sb $zero, 0x9($s0)    file 0xb08   rec.ctr = 0
WRITER_SIGNATURE = [
    (0xFFFF0000, 0xA6A00000),  # sh $zr, 0x54($s5)
    (0xFFFF0000, 0x8C440000),  # lw $a0, -0x6270($v0)   [0x800a9d90]
    (0xFFFF0000, 0x24630000),  # addiu $v1, 0x12        the 18-byte stride
    (0xFFFF0000, 0xA2160000),  # sb $s6, ($s0)          rec.active = 1
    (0xFFFF0000, 0xA2000000),  # sb $zr, 0x9($s0)       rec.ctr = 0
]
# The manager's build loop: `slti $v0, $s0, 0x6` (file 0xbb4) — six lamps.
MANAGER_LOOP = [(0xFFFF0000, 0x2A020000)]

WORD_RE = re.compile(
    r"\.L0x([0-9a-f]{8}): (?:\.word 0x([0-9a-f]+)|.*?# \.word 0x([0-9a-f]+))"
)


def _op(w: int) -> int:
    return w >> 26


def _rs(w: int) -> int:
    return (w >> 21) & 31


def _rt(w: int) -> int:
    return (w >> 16) & 31


def _imm(w: int) -> int:
    v = w & 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def load_words(path: Path) -> dict[int, int]:
    words: dict[int, int] = {}
    for m in WORD_RE.finditer(path.read_text()):
        words[int(m.group(1), 16)] = int(m.group(2) or m.group(3), 16)
    if not words:
        raise SystemExit(f"{path}: no overlay words found")
    return words


def image(words: dict[int, int]) -> bytes:
    buf = bytearray(max(words) + 4)
    for off, w in words.items():
        struct.pack_into("<I", buf, off, w)
    return bytes(buf)


def match_at(words: dict[int, int], offs: list[int], pattern: list) -> int | None:
    for start in offs:
        for i, want in enumerate(pattern):
            got = words.get(start + i * 4)
            if got is None or (got & want[0]) != want[1]:
                break
        else:
            return start
    return None


def function_start(words: dict[int, int], off: int) -> int | None:
    j = off
    while j > 0:
        w = words.get(j)
        if w is None:
            return None
        if _op(w) == 0x09 and _rt(w) == 29:  # addiu $sp, $zr, -N
            return j
        j -= 4
    return None


def addiu_from_hi(words: dict[int, int], lo: int, hi: int, imm: int) -> int | None:
    """The address `lui $r, 0x800b` + `addiu $r2, $r, imm` builds."""
    his: dict[int, int] = {}
    for off in range(lo, hi, 4):
        w = words.get(off)
        if w is None:
            continue
        if _op(w) == 0x0F and (w & 0xFFFF) == 0x800B:
            his[_rt(w)] = HI
            continue
        if _op(w) == 0x09 and _rs(w) in his and _imm(w) == imm:
            return (his[_rs(w)] + imm) & 0xFFFFFFFF
    return None


def read_list(img: bytes, at: int, base: int) -> list[tuple[int, int]]:
    """`{sprite id, hold}` halfword pairs, up to and including the 0xff entry."""
    out: list[tuple[int, int]] = []
    off = at - base
    while True:
        if off + 4 > len(img):
            raise SystemExit(f"list at 0x{at:X} runs past the overlay image")
        sprite, hold = struct.unpack_from("<2H", img, off)
        out.append((sprite, hold))
        off += 4
        if sprite == 0xFF:
            return out


def find_corner(words: dict[int, int]) -> dict | None:
    """Every address the three objects build, or None when this overlay is not
    the street corner."""
    offs = sorted(words)
    # The anchor is the writer's `sb $zr, 0x9($s0)` (rec.ctr = 0); the other
    # four signature words must sit in the SAME function, so they are looked up
    # inside its bounds rather than as one run.
    at = match_at(words, offs, [WRITER_SIGNATURE[-1]])
    if at is None:
        return None
    writer = function_start(words, at)
    if writer is None:
        return None
    span = [o for o in offs if writer <= o < writer + 0x200]
    if any(match_at(words, span, [want]) is None for want in WRITER_SIGNATURE[:-1]):
        return None
    seqs_at = addiu_from_hi(words, writer, writer + 0x200, -0x7AE8)
    if seqs_at is None:
        return None
    lamp_off = None
    for off in offs:
        w = words.get(off)
        if w is None or _op(w) != 0x09 or _imm(w) != -0x7BE0:
            continue
        if _rs(w) not in (2, 3):
            continue
        lamp_off = off
        break
    if lamp_off is None:
        return None
    lamp_fn = function_start(words, lamp_off)
    if lamp_fn is None:
        return None
    loop = match_at(words, offs, MANAGER_LOOP)
    lamp_count = _imm(words[loop]) if loop is not None else 0
    return {
        "writerTick": writer + OVERLAY_BASE,
        "lampTick": lamp_fn + OVERLAY_BASE,
        "sequencePointers": seqs_at,
        "lampTable": HI - 0x7BE0,
        "lampCount": lamp_count,
    }


def read_tables(words: dict[int, int], info: dict) -> dict:
    img = image(words)
    base = OVERLAY_BASE
    # Two sequence lists, named by the pointer table the writer indexes.
    seq_ptrs = []
    for i in range(2):
        (ptr,) = struct.unpack_from("<I", img, info["sequencePointers"] - base + i * 4)
        seq_ptrs.append(ptr)
    sequences = [read_list(img, p, base) for p in seq_ptrs]
    # The lamp table: {list pointer, x:half, y:half} records, one per lamp.
    lamps = []
    for i in range(info["lampCount"]):
        off = info["lampTable"] - base + i * 8
        ptr, packed = struct.unpack_from("<IH", img, off)
        x, y = struct.unpack_from("<2H", img, off + 4)
        lamps.append({"list": read_list(img, ptr, base), "x": x, "y": y})
    return {"sequences": sequences, "lamps": lamps, **info}


def render(stages: dict[str, dict]) -> str:
    def seq(rows: list[tuple[int, int]]) -> str:
        return ", ".join(f"[{s}, {h}]" for s, h in rows)

    body = []
    for stage, t in stages.items():
        seqs = ",\n".join(f"            [{seq(r)}]" for r in t["sequences"])
        lamps = ",\n".join(
            "            { list: [%s], x: %d, y: %d }"
            % (seq(l["list"]), l["x"], l["y"])
            for l in t["lamps"]
        )
        body.append(
            f"    {stage}: {{\n"
            f"        writerTick: 0x{t['writerTick']:X},\n"
            f"        lampTick: 0x{t['lampTick']:X},\n"
            f"        lampCount: {t['lampCount']},\n"
            f"        sequences: [\n{seqs},\n        ],\n"
            f"        lamps: [\n{lamps},\n        ],\n"
            f"    }},\n"
        )
    return (
        "// GENERATED by tools/extract_street_lights.py — do not hand-edit.\n"
        "//\n"
        "// The traffic-light corner the Kusanagi City street overlay builds for\n"
        "// itself: six two-frame glow sprites at fixed map pixels, and the two\n"
        "// lamp sequences the writer plays into the point records. Read out of\n"
        "// the overlay by the routines that use them; decode:\n"
        "// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md\n"
        "\n"
        "export interface StreetLightLamp {\n"
        "    /** {sprite id, hold} pairs; the 0xff entry loops back to the start. */\n"
        "    list: readonly (readonly [number, number])[];\n"
        "    /** map pixels, the two halfwords at the record's +4 and +6. */\n"
        "    x: number;\n"
        "    y: number;\n"
        "}\n"
        "\n"
        "export interface StreetLightTables {\n"
        "    /** The traffic-light writer's tick, for the record. */\n"
        "    writerTick: number;\n"
        "    /** The glow object's tick — the same routine for all six lamps. */\n"
        "    lampTick: number;\n"
        "    /** How many lamps the manager builds (`slti $v0, $s0, 0x6`). */\n"
        "    lampCount: number;\n"
        "    /** The two lamp sequences, in pointer-table order. */\n"
        "    sequences: readonly (readonly (readonly [number, number])[])[];\n"
        "    lamps: readonly StreetLightLamp[];\n"
        "}\n"
        "\n"
        "export const STREET_LIGHT_TABLES: Record<string, StreetLightTables> = {\n"
        + "".join(body)
        + "};\n"
    )


def scan_all() -> dict[str, dict]:
    found: dict[str, dict] = {}
    census: list[tuple[str, str | None]] = []
    for path in sorted(ASM.glob("wstag*.s")):
        words = load_words(path)
        info = find_corner(words)
        stage = "s" + path.stem.removeprefix("wstag")
        if info is None:
            census.append((stage, None))
            continue
        census.append((stage, "carries the traffic-light corner"))
        found[stage] = read_tables(words, info)
    return {"found": found, "census": census}


def main() -> None:
    result = scan_all()
    if "--census" in sys.argv:
        for stage, note in result["census"]:
            print(f"{stage}: {note or '-'}")
        print(
            f"membership census over {len(result['census'])} stage overlays: "
            f"{len(result['found'])} carry the traffic-light corner"
        )
        return
    if not result["found"]:
        raise SystemExit("no overlay carries the traffic-light corner")
    text = render(result["found"])
    if "--write" in sys.argv:
        OUT.write_text(text)
        print(f"wrote {OUT}")
        return
    if not OUT.exists():
        raise SystemExit(f"{OUT} missing; run with --write")
    if OUT.read_text() != text:
        raise SystemExit(f"{OUT} differs from the disc tables; rerun with --write")
    print(f"{OUT} matches the disc tables for {sorted(result['found'])}")


if __name__ == "__main__":
    main()
