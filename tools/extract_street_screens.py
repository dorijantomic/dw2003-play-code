#!/usr/bin/env python3
"""Street-screen tables: the quad driver the Kusanagi City street corner builds
for the wall/column screens, read out of the overlay that carries it.

The system is the A.O.A news screens (and the idle street screens under them).
Everything it needs lives in the stage overlay and is located BY CODE, never by
a hand list: the whole-function normalised-word sweep over all 294 wstag
overlays finds exactly one copy of the quad builder and one of its tick
(`tools`-run census; the result is asserted by tests/street-screens.test.js).

Chain, each step read out of the image rather than assumed:

  fieldstg effect registry (RAM 0x8009b3e8, 12-byte records `{id, ctor, draw}`)
      record whose ctor points INSIDE this overlay  ->  the driver's ctor
  that ctor: `lui/addiu $a0, TICK / li $a1, SIZE / jal F0x800143dc`
      -> the tick (the allocator installs its first argument as +0x48, the
         tick callback), the object's size, and the registry id
  the tick (wstag780 0x800a72b0):
      `li $s1, BASE / addu $s0,$s3,$s1 / lw $v1,($s0) / lw $v0,0x4($s0)`
      -> two cursor blocks of STRIDE bytes at BASE (file 0x1554-0x1560)
      `slti $v0,$s2, COUNT / addiu $s1, STRIDE`   -> the cursor count/stride
      `lui/addiu $s4, SEQTABLES`                  -> the sequence pointer table
      the state-0 arm's stores to +BASE / +BASE+STRIDE -> the boot pair, and the
      pair it writes at +BASE+4 (the "previous tick" sentinel)
  the registry draw (wstag780 0x800a7450):
      `li $v0, SUBID / bne $a1,$v0` then `li $v0,IMM / sw $v0,BASE($v1)`
      -> the sub id that switches to the news pair, the pair itself, and the
         packed sound word played on the switch
  the quad builder (wstag780 0x800a6fbc), called from the tick:
      `li $v0,9 / sb $v0,-0xb($a1) / li $v0,0x2c / sb $v0,-0x7($a1)`
      -> the 0x28-byte quad header the builder writes; with the enclosing
      `slti $v0,$t2, COUNT` / `addiu $t0, STRIDE` it also gives the quad count,
      the record stride, `lui/addiu $t4, TEXTURES` and `lui/addiu $a3, RECORDS`

Tables read per stage (RAM addresses from the code above, sizes derived, never
typed by hand):

  * texture entries at TEXTURES, 16 bytes each, COUNT_TEX =
    (RECORDS - TEXTURES) / 16. Each entry packs `{u:u8 @+8, v:u8 @+0xa}` plus
    the two register words the builder derives from it: the texpage word
    `((e[0]&0x3ff)>>6) | (bit8(e[2])?0x10:0) | (bit9(e[2])?0x800:0)` and the
    clut word `(e[0xe]<<6) | ((e[0xc]>>4)&0x3f)`, both truncated to 16 bits
    (builder file 0x1418-0x1460).
  * screen records at RECORDS, 18 bytes each: four `{x, y}` u16 corner pairs
    (the corners are the screen parallelogram) and an s16 type at +0x10.
  * sequence tables named by the pointer table at SEQTABLES: pairs of
    `{value:u8, duration:u8}`. A zero duration is a JUMP -- the cursor's
    position becomes the value byte (builder/tick file 0x15c8-0x15e0). The
    tables are contiguous and end where the pointer table begins, so each
    table's length is the distance to the next pointer.

Usage:
  python3 tools/extract_street_screens.py --check   # compare (default)
  python3 tools/extract_street_screens.py --write   # regenerate
  python3 tools/extract_street_screens.py --census  # membership only
"""

from __future__ import annotations

import re
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ASM = Path.home() / "ddw3/asm/dw2003/pro"
OUT = REPO / "engine/dw3/street-screen-tables.ts"
FIELDSTG = REPO / "web/assets/native/fieldstg.bin"

FIELDSTG_BASE = 0x80082CB0
EFFECT_REGISTRY = 0x8009B3E8
EFFECT_RECORD = 12  # {u32 id, u32 ctor, u32 draw}
ALLOC_WITH_ID = 0x800143DC  # (cb, size, extra, id) -- registers the object

WORD_RE = re.compile(
    r"\.L0x([0-9a-f]{8}): (?:\.word 0x([0-9a-f]+)|.*?# \.word 0x([0-9a-f]+))"
)

# ---------------------------------------------------------------- signatures

# The quad header the builder writes: the marker byte 9 at record+3 and the
# 0x2C command byte at record+7, with the type read between the two stores and
# the `slti` that decides 0x2E. The record offsets differ per overlay, so the
# stores and the type read carry a wildcard for their immediate only.
QUAD_HEADER = [
    0x24020009,  # li   $v0, 0x9
    None,  # sb   $v0, OFF+3
    0x2402002C,  # li   $v0, 0x2c
    None,  # sb   $v0, OFF+7
    None,  # lh   $v0, TYPE_OFF($a3)
    None,  # nop
    0x28420009,  # slti $v0, 0x9
]

# The tick's cursor loop head: the block base, then the two loads the
# "changed since last tick" compare reads.
CURSOR_LOOP = [
    None,  # li   $s1, BASE
    None,  # addu $s0, $s3, $s1
    0x8E030000,  # lw   $v1, ($s0)
    0x8E020004,  # lw   $v0, 0x4($s0)
    None,  # nop
    None,  # beq  $v1, $v0
]

# The registry draw's guard: the sub id compared against $a1.
DRAW_GUARD = [
    0x24020322,  # li   $v0, 0x322
    0x14A2000B,  # bne  $a1, $v0, +0x0b
]


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
    end = max(words) + 4
    buf = bytearray(end)
    for off, w in words.items():
        struct.pack_into("<I", buf, off, w)
    return bytes(buf)


def _hit(got: int, want) -> bool:
    """`None` matches any word, an int must be exact, a `(mask, value)` pair
    compares only the masked bits (so a pattern can keep the opcode+registers
    and leave the immediate free)."""
    if want is None:
        return True
    if isinstance(want, tuple):
        return (got & want[0]) == want[1]
    return got == want


def match_at(words: dict[int, int], offs: list[int], pattern: list) -> int | None:
    """First offset in `offs` where `pattern` matches."""
    for start in offs:
        for i, want in enumerate(pattern):
            got = words.get(start + i * 4)
            if got is None or not _hit(got, want):
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


def li_const(words: dict[int, int], reg: int, before: int, floor: int = 0) -> int | None:
    """Value of `li $reg, imm` -- the newest one above `floor` and below
    `before`. The original builds these sequence numbers with `li` well above
    the store that consumes them, so a local constant walk beats a window."""
    found = None
    off = floor
    while off < before:
        w = words.get(off)
        if w is not None and _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == reg:
            found = _imm(w)
        off += 4
    return found


def lui_addiu(words: dict[int, int], lo: int, hi: int, reg: int) -> int | None:
    """The 32-bit address `reg` is given by a `lui`/`addiu` pair.

    The two halves are not always in the same register: wstag780's builder does
    `lui $v0, 0x800b` then `addiu $t4, $v0, -0x7ae0` (0x800A8520), so the pair is
    tracked per register and the result is taken when the named register is the
    `addiu` destination. A `lui` alone is never a value."""
    hi_vals: dict[int, int] = {}
    for off in range(lo, hi, 4):
        w = words.get(off)
        if w is None:
            continue
        if _op(w) == 0x0F:  # lui $rt, imm
            hi_vals[_rt(w)] = (w & 0xFFFF) << 16
            continue
        if _op(w) == 0x09 and _rt(w) == reg:  # addiu $reg, $rs, imm
            src = _rs(w)
            if src in hi_vals:
                return (hi_vals[src] + _imm(w)) & 0xFFFFFFFF
    return None


def stores_to(words: dict[int, int], lo: int, hi: int, reg: int) -> dict[int, int]:
    """{object offset: stored register} for every `sw $rX, offset($reg)`.

    `sw` encodes the SOURCE in $rt and the base in $rs, so the register being
    written is read out of the $rt field."""
    out: dict[int, int] = {}
    for off in range(lo, hi, 4):
        w = words.get(off)
        if w is None or _op(w) != 0x2B or _rs(w) != reg:
            continue
        out[_imm(w)] = _rt(w)
    return out


# ------------------------------------------------------------------ decode


def find_driver(words: dict[int, int], base: int) -> dict | None:
    """Everything the tick, the builder and the registry draw say, or None."""
    offs = sorted(words)
    header = match_at(words, offs, QUAD_HEADER)
    loop = match_at(words, offs, CURSOR_LOOP)
    if header is None or loop is None:
        return None
    builder = function_start(words, header)
    tick = function_start(words, loop)
    if builder is None or tick is None:
        return None
    b_lo, t_lo = builder, tick
    b_hi = b_lo + 0x400
    t_hi = t_lo + 0x400

    def find(pattern, lo, hi):
        return match_at(words, [o for o in offs if lo <= o < hi], pattern)

    # The builder's two tables and its loop bounds.
    textures = lui_addiu(words, b_lo, b_hi, 12)  # $t4
    records = lui_addiu(words, b_lo, b_hi, 7)  # $a3
    quads = find([(0xFFFF0000, 0x29420000)], b_lo, b_hi)  # slti $v0, $t2, imm
    stride_at = find([(0xFFFF0000, 0x25080000)], b_lo, b_hi)  # addiu $t0, imm
    rec_step = find([(0xFFFF0000, 0x24E70000)], b_lo, b_hi)  # addiu $a3, imm
    if textures is None or records is None or quads is None or stride_at is None or rec_step is None:
        return None
    quad_count = _imm(words[quads] & 0xFFFF)
    quad_stride = _imm(words[stride_at] & 0xFFFF)
    record_stride = _imm(words[rec_step] & 0xFFFF)

    # The tick's cursor blocks and its sequence pointer table.
    base_off = loop  # the `li $s1, BASE`
    cursor_base = _imm(words[base_off] & 0xFFFF)
    seq_tables = lui_addiu(words, t_lo, t_hi, 20)  # $s4 (MIPS s4 = 20)
    count_at = find([(0xFFFF0000, 0x2A420000)], t_lo, t_hi)  # slti $v0, $s2, imm
    step_at = find([(0xFFFF0000, 0x26310000)], t_lo, t_hi)  # addiu $s1, imm
    if seq_tables is None or count_at is None or step_at is None:
        return None
    cursor_count = _imm(words[count_at] & 0xFFFF)
    cursor_stride = _imm(words[step_at] & 0xFFFF)

    # The state-0 arm: the stores to +BASE / +BASE+STRIDE and their `li` values,
    # plus the sentinel pair at +BASE+4 / +BASE+STRIDE+4.
    arm_stores = stores_to(words, t_lo, loop, 19)  # $s3
    boot = []
    last = []
    for k in range(cursor_count):
        off = cursor_base + k * cursor_stride
        reg = arm_stores.get(off)
        reg4 = arm_stores.get(off + 4)
        if reg is None or reg4 is None:
            return None
        boot.append(li_const(words, reg, arm_stores_off(words, t_lo, loop, 19, off), t_lo))
        last.append(li_const(words, reg4, arm_stores_off(words, t_lo, loop, 19, off + 4), t_lo))

    # The registry draw: the sub id and the pair it switches to.
    draw_at = find(DRAW_GUARD, 0, max(offs) + 4)
    draw = function_start(words, draw_at) if draw_at is not None else None
    news = [0, 0]
    sound = None
    if draw is not None:
        d_stores = stores_to(words, draw, draw + 0x80, 3)  # $v1 (MIPS v1 = 3)
        for k in range(cursor_count):
            off = cursor_base + k * cursor_stride
            reg = d_stores.get(off)
            if reg is None:
                return None
            news[k] = li_const(words, reg, arm_stores_off(words, draw, draw + 0x80, 3, off), draw)
        sound = packed_sound(words, draw, draw + 0x80)

    return {
        "builder": builder,
        "tick": tick,
        "textures": textures,
        "records": records,
        "quad_count": quad_count,
        "quad_stride": quad_stride,
        "record_stride": record_stride,
        "cursor_base": cursor_base,
        "cursor_count": cursor_count,
        "cursor_stride": cursor_stride,
        "seq_tables": seq_tables,
        "boot": boot,
        "last": last,
        "draw": draw,
        "news": news,
        "sound": sound,
        "base": base,
    }


def arm_stores_off(words, lo, hi, reg, off) -> int:
    """The offset of the `sw $rX, off($reg)` that wrote `off` (the floor for the
    `li` walk, so a stale constant from further up cannot be picked up)."""
    for o in range(lo, hi, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x2B or _rs(w) != reg:
            continue
        if _imm(w) == off:
            return o
    return lo


def packed_sound(words: dict[int, int], lo: int, hi: int) -> int | None:
    """The packed sound word a `lw $vX, 0x5c48($vY)` call plays: `lui $a0, hi`
    plus the $a0 low half that follows the call."""
    cell = None
    for off in range(lo, hi, 4):
        w = words.get(off)
        if w is None or _op(w) != 0x23:
            continue
        if _imm(w) == 0x5C48:
            cell = off
            break
    if cell is None:
        return None
    high = None
    for off in range(lo, cell, 4):
        w = words.get(off)
        if w is not None and _op(w) == 0x0F and _rt(w) == 4:
            high = (w & 0xFFFF) << 16
    if high is None:
        return None
    for off in range(cell + 4, min(cell + 0x30, hi), 4):
        w = words.get(off)
        if w is None:
            continue
        if _op(w) == 0x0D and _rt(w) == 4:
            return high | (w & 0xFFFF)
    return None


def registry_records() -> list[tuple[int, int, int]]:
    data = FIELDSTG.read_bytes()
    out = []
    off = EFFECT_REGISTRY - FIELDSTG_BASE
    for i in range(64):
        if off + EFFECT_RECORD > len(data):
            break
        a, b, c = struct.unpack_from("<III", data, off + i * EFFECT_RECORD)
        if a == 0:
            break
        out.append((a, b, c))
    return out


def find_registry_id(words: dict[int, int], base: int, tick: int) -> tuple[int | None, int | None]:
    """(effect-registry id, object size) for the object whose tick is `tick`.

    The chain is the original's own: the registry record names a ctor inside
    this overlay, that ctor calls the id-taking allocator with the tick as its
    first argument (the allocator installs it as +0x48, the tick callback), and
    the tick address is the last `lui $a0` / `addiu $a0` pair before that call --
    NOT an adjacent pair, because `li $a1, size` sits between them."""
    for off in sorted(words):
        w = words[off]
        if _op(w) != 0x03 or 0x80000000 + ((w & 0x03FFFFFF) << 2) != ALLOC_WITH_ID:
            continue
        high = None
        high_at = None
        for back in range(4, 0x24, 4):
            hw = words.get(off - back)
            if hw is None:
                break
            if _op(hw) == 0x0F and _rt(hw) == 4:
                high = (hw & 0xFFFF) << 16
                high_at = off - back
                break
        if high is None:
            continue
        # The low half is the newest `addiu/ori $a0` between that lui and the
        # call itself (in wstag780 it sits two instructions before the jal, with
        # `li $a1, size` between it and the call).
        tick_addr = None
        for fwd in range(high_at + 4, off, 4):
            fw = words.get(fwd)
            if fw is None or _op(fw) not in (0x09, 0x0D) or _rt(fw) != 4:
                continue
            tick_addr = (high + _imm(fw)) & 0xFFFFFFFF
        if tick_addr != tick:
            continue
        size = None
        for back in range(4, 0x24, 4):
            hw = words.get(off - back)
            if hw is None:
                break
            if _op(hw) == 0x09 and _rs(hw) == 0 and _rt(hw) == 5:
                size = _imm(hw)
                break
        ctor = function_start(words, off)
        if ctor is None:
            return None, size
        for rid, rctor, _draw in registry_records():
            if rctor == base + ctor:
                return rid, size
    return None, None


def read_tables(img: bytes, base: int, info: dict) -> dict:
    """The texture entries, screen records and sequence tables."""
    tex_off = info["textures"] - base
    rec_off = info["records"] - base
    quad_count = info["quad_count"]
    # The screen table's own stride (`addiu $a3, 0x12`, builder file 0x140c) is
    # NOT the 0x28-byte stride of the quads it produces (`addiu $t0, 0x28`).
    stride = info["record_stride"]

    tex_count = (rec_off - tex_off) // 16
    textures = []
    for i in range(tex_count):
        o = tex_off + i * 16
        e0, e2 = struct.unpack_from("<H", img, o)[0], struct.unpack_from("<H", img, o + 2)[0]
        ec, ee = struct.unpack_from("<H", img, o + 0xC)[0], struct.unpack_from("<H", img, o + 0xE)[0]
        textures.append(
            {
                "u": img[o + 8],
                "v": img[o + 0xA],
                "texpage": (((e0 & 0x3FF) >> 6) | (0x10 if e2 & 0x100 else 0)
                            | (0x800 if e2 & 0x200 else 0)) & 0xFFFF,
                "clut": ((ee << 6) | ((ec >> 4) & 0x3F)) & 0xFFFF,
            }
        )

    records = []
    for i in range(quad_count):
        o = rec_off + i * stride
        corners = struct.unpack_from("<8H", img, o)
        kind = struct.unpack_from("<h", img, o + 0x10)[0]
        records.append(
            {
                "x": [corners[0], corners[2], corners[4], corners[6]],
                "y": [corners[1], corners[3], corners[5], corners[7]],
                "type": kind,
            }
        )

    # The sequence tables are windows into ONE shared byte program: table N+1
    # starts at table N + its own length, so the six tables overlap and each
    # one's jump targets are relative to its own base. Every table therefore
    # runs to the pointer table itself, which is where the shared program ends
    # (wstag780: table 0 = 122 entries at 0x800A8D20, table 5 = 46 at
    # 0x800A8DB8, and 0x800A8DB8 + 46*2 == 0x800A8E14 exactly).
    ptr_off = info["seq_tables"] - base
    count = max(info["boot"] + info["news"]) + 1
    sequences = []
    for i in range(count):
        p = struct.unpack_from("<I", img, ptr_off + 4 * i)[0]
        o = p - base
        n = (info["seq_tables"] - p) // 2
        sequences.append([(img[o + 2 * k], img[o + 2 * k + 1]) for k in range(n)])
    return {"textures": textures, "records": records, "sequences": sequences}


# ------------------------------------------------------------------ render


def render(stages: dict[str, dict]) -> str:
    out = [
        "// GENERATED by tools/extract_street_screens.py — do not hand-edit.",
        "//",
        "// The wall/column screens a stage overlay builds for itself: the quad",
        "// driver (its tick, its 0x28-byte quad builder, its effect-registry",
        "// entry) plus the three tables it reads. Every value below was located",
        "// by code in the overlay and read out of the disc image; see",
        "// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md.",
        "",
        "/** One 16-byte texture entry of the driver's texture table. */",
        "export interface StreetScreenTexture {",
        "    /** Texture u inside the page (builder file 0x13a8: `lbu 0x8($a2)`). */",
        "    u: number;",
        "    /** Texture v inside the page (builder file 0x13e0: `lbu 0xa($a2)`). */",
        "    v: number;",
        "    /** The texpage register word (builder file 0x1418-0x1444). */",
        "    texpage: number;",
        "    /** The clut register word (builder file 0x1448-0x1460). */",
        "    clut: number;",
        "}",
        "",
        "/** One screen: the four corners of its parallelogram and its type. */",
        "export interface StreetScreenRecord {",
        "    /** Corner x, in the order the builder stores them (record +8..+0x20). */",
        "    x: readonly number[];",
        "    /** Corner y, same order. */",
        "    y: readonly number[];",
        "    /** -1 selects nothing dynamic, 0 the first cursor, 1 the second,",
        "     *  anything else is a fixed texture entry index (builder file 0x1274). */",
        "    type: number;",
        "}",
        "",
        "export interface StreetScreenTables {",
        "    /** The effect-registry id the stage script fires (SETANIM 801 …). */",
        "    effectId: number;",
        "    /** The two sequence indices the driver's first tick installs. */",
        "    boot: readonly number[];",
        "    /** What the registry draw installs when the news opcode arrives. */",
        "    news: readonly number[];",
        "    /** The second halfword that selects `news` (registry draw). */",
        "    newsSubId: number;",
        "    /** The packed sound the same draw plays (0xA4 high, 0x6 low). */",
        "    newsSound: number;",
        "    /** Cursor block bytes, and how many blocks the tick walks. */",
        "    cursorBase: number;",
        "    cursorStride: number;",
        "    cursorCount: number;",
        "    /** Texture entries; a record's type indexes this by *16 in the",
        "     *  original, so entry N is `textures[N]`. */",
        "    textures: readonly StreetScreenTexture[];",
        "    /** The screens, one record per quad the builder submits. */",
        "    records: readonly StreetScreenRecord[];",
        "    /** Sequence tables: `{value, duration}` byte pairs. A zero",
        "     *  duration is a jump (the position becomes the value). */",
        "    sequences: readonly (readonly (readonly [number, number])[])[];",
        "}",
        "",
        "export const STREET_SCREEN_TABLES: Record<string, StreetScreenTables> = {",
    ]
    for stage, d in stages.items():
        t = d["tables"]
        info = d["info"]
        out.append(f"    {stage}: {{")
        out.append(f"        effectId: 0x{info['effectId']:x},")
        out.append("        boot: [" + ", ".join(str(v) for v in info["boot"]) + "],")
        out.append("        news: [" + ", ".join(str(v) for v in info["news"]) + "],")
        out.append(f"        newsSubId: 0x{info['newsSubId']:x},")
        out.append(f"        newsSound: 0x{info['newsSound']:06x},")
        out.append(f"        cursorBase: 0x{info['cursor_base']:x},")
        out.append(f"        cursorStride: 0x{info['cursor_stride']:x},")
        out.append(f"        cursorCount: {info['cursor_count']},")
        out.append("        textures: [")
        for e in t["textures"]:
            out.append(
                f"            {{ u: {e['u']}, v: {e['v']}, texpage: 0x{e['texpage']:04x},"
                f" clut: 0x{e['clut']:04x} }},"
            )
        out.append("        ],")
        out.append("        records: [")
        for r in t["records"]:
            xs = ", ".join(str(v) for v in r["x"])
            ys = ", ".join(str(v) for v in r["y"])
            out.append(f"            {{ x: [{xs}], y: [{ys}], type: {r['type']} }},")
        out.append("        ],")
        out.append("        sequences: [")
        for seq in t["sequences"]:
            pairs = ", ".join(f"[{value}, {dur}]" for value, dur in seq)
            out.append("            [")
            # one row per 8 pairs, so a table stays readable in the diff
            row = []
            for value, dur in seq:
                row.append(f"[{value}, {dur}],")
                if len(row) == 8:
                    out.append("                " + " ".join(row))
                    row = []
            if row:
                out.append("                " + " ".join(row))
            out.append("            ],")
        out.append("        ],")
        out.append("    },")
    out.append("};")
    out.append("")
    return "\n".join(out)


# -------------------------------------------------------------------- main


def scan_all() -> dict[str, dict]:
    found: dict[str, dict] = {}
    census: list[tuple[str, str | None]] = []
    for path in sorted(ASM.glob("wstag*.s")):
        stage = path.stem.replace("wstag", "s")
        words = load_words(path)
        base = 0x800A5DE0
        info = find_driver(words, base)
        if info is None:
            census.append((stage, None))
            continue
        rid, size = find_registry_id(words, base, base + info["tick"])
        if rid is None:
            census.append((stage, "no registry id"))
            continue
        img = image(words)
        info["effectId"] = rid
        info["objectSize"] = size
        info["tickRam"] = base + info["tick"]
        info["builderRam"] = base + info["builder"]
        info["newsSubId"] = 0x322
        info["newsSound"] = info["sound"]
        tables = read_tables(img, base, info)
        found[stage] = {"info": info, "tables": tables, "base": base}
        census.append(
            (
                stage,
                f"effect 0x{rid:03x} tick 0x{base + info['tick']:08x}"
                f" builder 0x{base + info['builder']:08x} draw 0x{base + info['draw']:08x}",
            )
        )
    return {"found": found, "census": census}


def main() -> None:
    result = scan_all()
    hits = result["found"]
    print(f"membership census over 294 stage overlays: {len(hits)} carry the driver")
    for stage, note in result["census"]:
        if note:
            print(f"  {stage}: {note}")
    if not hits:
        raise SystemExit("no stage overlay carries the screen-quad driver")
    if "--census" in sys.argv:
        return
    text = render(hits)
    if "--write" in sys.argv:
        OUT.write_text(text)
        print(f"wrote {OUT}")
        return
    if not OUT.exists():
        raise SystemExit(f"{OUT} missing; run with --write")
    if OUT.read_text() != text:
        raise SystemExit(f"{OUT} differs from the disc tables; rerun with --write")
    print(f"{OUT} matches the disc tables for {', '.join(sorted(hits))}")


if __name__ == "__main__":
    main()
