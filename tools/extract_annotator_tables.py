#!/usr/bin/env python3
"""Lift the resident draw-context annotator's stage tables out of the overlays.

The service itself is the resident 2D draw-context object with registry id
0x1002 (exe/fns.s:15844 `F0x8001E5BC` installs its 23-slot method table; see
docs/research/field/draw-context-service-2026-10-04.md).  Two stage-owned
members of the stage-object registry draw through it:

  s805 0x349 (841)  tick 0x800A5DE4  -- 27 pooled children on a delay walk
  s820 0x34d (845)  tick 0x800A6488  -- 4 children from a descriptor table

This tool reads only the overlay words those two members read, and writes
engine/dw3/annotator-tables.ts.  `--check` re-derives them and fails if the
generated file differs, so a hand edit of the table cannot land.

Every offset below is a FILE offset into the overlay image; the load base is
0x800A5DE0 for both overlays (the region the loader uses for every wstag*).

    usage: tools/extract_annotator_tables.py [--check]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASM = os.path.expanduser("~/ddw3/asm/dw2003/pro")
OUT = os.path.join(REPO, "engine/dw3/annotator-tables.ts")

# wstag* overlays all load at this base; the labels in the .s are file offsets.
OVERLAY_BASE = 0x800A5DE0

WORD = re.compile(r"^\.L0x([0-9a-f]{8}): \.word 0x([0-9a-f]{8})")
INSTR = re.compile(r"^\.L0x[0-9a-f]+: (\S+)\s*(.*?)\s+#")

# The sixteen overlays that carry the two-pass annotator (the census in
# engine/systems/shape-annotator.ts is derived from the same code search).
FAMILY = [
    "wstag205", "wstag310", "wstag311", "wstag735", "wstag736", "wstag740",
    "wstag741", "wstag745", "wstag746", "wstag750", "wstag800", "wstag805",
    "wstag810", "wstag815", "wstag820",
]


def shape_set_resource(overlay: str) -> dict:
    """The stage's own shape-set handle, from its field-config stub.

    Every wstag overlay has one routine that fills the resident field object at
    0x80049D80 (the loader reaches it as `lui $a2, 0x800a; addiu $a2, -0x6280`;
    wstag820.s:707).  It stores the stage's shape-set handle at that object's
    `+0x0C`: a packed word whose high half is the CD resource id and whose low
    half is the member (wstag820.s:704-708 for s820, wstag805.s:932-936 for
    s805).  The draw resolves it with `*(0x80044F5C)`, i.e. F0x800140D8, and
    every annotator callback in the family hands the result straight to the
    shape emitter (wstag820.s:362-368, wstag805.s:898-904).
    """
    path = os.path.join(ASM, f"{overlay}.s")
    ins: list[tuple[str, list[str]]] = []
    with open(path) as fh:
        for line in fh:
            if "# End of code" in line:
                break
            m = INSTR.match(line)
            if not m:
                continue
            args = [a.strip() for a in m.group(2).split(",") if a.strip()]
            ins.append((m.group(1), args))
    for i, (op, args) in enumerate(ins):
        if op == "addiu" and len(args) >= 2 and args[-1] == "-0x6280" and args[0].startswith("$"):
            base = args[0]  # $a2 in most overlays, $s1 in the rest
            hi = None
            for op2, args2 in ins[i + 1:i + 12]:
                if op2 == "lui" and args2[:1] == ["$v0"]:
                    hi = int(args2[1], 0)
                elif op2 == "sw" and args2 == ["$v0", f"0xc({base})"]:
                    if hi is None:
                        raise SystemExit(f"{overlay}: +0x0C stored without a lui")
                    return {"resource": hi, "handle": hi << 16, "line": None}
    raise SystemExit(f"{overlay}: no `sw $v0, 0xc($r)` after the field-config stub")


def words(overlay: str) -> dict[int, int]:
    """file offset -> big-endian word, for the .word data of one overlay."""
    path = os.path.join(ASM, overlay)
    out: dict[int, int] = {}
    with open(path) as fh:
        for line in fh:
            m = WORD.match(line)
            if m:
                out[int(m.group(1), 16)] = int(m.group(2), 16)
    if not out:
        raise SystemExit(f"{overlay}: no .word data found in {path}")
    return out


def ram(offset: int) -> str:
    return f"0x{OVERLAY_BASE + offset:X}"


def s16(v: int) -> int:
    return v - 0x10000 if v & 0x8000 else v


def i32(v: int) -> int:
    return v - 0x100000000 if v & 0x80000000 else v


def halfwords(w: dict[int, int], start: int, count: int) -> list[int]:
    """`count` halfwords from `start`, in the order the overlays address them.

    These `.s` files print each data word with its two halves in the opposite
    order to address order: `lh $v0, 0($s1)` at wstag820.s:281 lands on the LOW
    half of the printed word, not the high one.  The s820 record table proves it
    both ways -- printed `0x0002003c` reads as hold 0x3C and kind 2, which is the
    one record that takes the default-child arm at :178, and printed
    `0x000000ff` in every step table lands on the 0x00FF end marker the walk
    tests for at :301.  Full-word reads (`lw 0x4($s0)`) are unaffected.
    """
    out = []
    for i in range(count):
        off = start + i * 2
        v = w[off & ~3]
        out.append((v & 0xFFFF) if (off & 2) == 0 else (v >> 16))
    return out


def s805() -> dict:
    """The 0x349 member: descriptors, delay walk, the two shape-step tables."""
    w = words("wstag805.s")
    # 27 twelve-byte descriptors at file 0x12BC; the sequencer reads three words
    # per record and hands them to the child constructor (wstag805.s:596-601,
    # :747-752).  `slti $v0, $s2, 0x1b` at :698 is the 27.
    desc = []
    for i in range(27):
        base = 0x12BC + i * 12
        x = i32(w[base])
        y = i32(w[base + 4])
        shape = i32(w[base + 8])
        desc.append({"x": x, "y": y, "shape": shape})
    # 28 halfwords at file 0x1400: table[i] is the lower bound of child i's
    # window and table[27] = 0x1000 is the end marker the sequencer tests
    # (wstag805.s:46-95, `lh $v0, ($v0)` at :743 and :761).
    delay = [s16(x) for x in halfwords(w, 0x1400, 28)]
    # The three step tables the child's draw reads: the disc (0x72B8), the
    # second pass's table (0x7300) and the column (0x73A0).  Each is a run of
    # {key, hold} four-byte records ended by the 0x00FF marker key
    # (wstag805.s:384-400 and :517-534).
    # The original bounds nothing: `addiu $s0, 0x4` walks four-byte {key, hold}
    # records straight on (wstag820.s:367) until a key of 0x00FF, and each table
    # here runs up to the next one in the image, so that is where each read ends.
    def step_table(start: int, limit: int) -> list[dict]:
        hv = halfwords(w, start, (limit - start) // 2)
        out = []
        for i in range(0, len(hv) - 1, 2):
            key = s16(hv[i])
            out.append({"key": key, "hold": hv[i + 1]})
            if key == 0xFF:
                break  # the end marker the walk tests for at wstag820.s:301
        return out

    return {
        "stage": "805",
        "member": "0x349",
        "member_id": 841,
        "tick": ram(0x0004),
        "children": desc,
        "delay": delay,
        "tables": {
            "disc": step_table(0x14D8, 0x1520),
            "second": step_table(0x1520, 0x15C0),
            "column": step_table(0x15C0, 0x1640),
        },
        "sources": {
            "descriptors": ram(0x12BC),
            "delay": ram(0x1400),
            "disc": ram(0x14D8),
            "second": ram(0x1520),
            "column": ram(0x15C0),
        },
    }


def s820() -> dict:
    """The 0x34d member: four descriptor-built children and two step tables."""
    w = words("wstag820.s")
    # Four twelve-byte records at file 0x13CC, read by the stage entry loop
    # (wstag820.s:170-183): `lh $v1, 0x2($s0)` picks the kind, `lh $a2, ($s0)`
    # the hold, `lw $a0/$a1` the position.  kind 2 builds the default child at
    # the constants its own constructor stores (:634-641); kind 0 builds one at
    # the record's own position (:605-613).
    recs = []
    for i in range(4):
        base = 0x13CC + i * 12
        hv = halfwords(w, base, 2)
        recs.append(
            {
                "hold": s16(hv[0]),
                "kind": s16(hv[1]),
                "x": i32(w[base + 4]),
                "y": i32(w[base + 8]),
            }
        )
    # The default constructor's constants: child+0x54 = 0x1CC, +0x58 = 0x1B4,
    # +0x50 = 0x3C (wstag820.s:634-641, `li $v1, ...` then `sw $v1, 0x54($v0)`).
    default = {"x": 0x1CC, "y": 0x1B4, "hold": 0x3C}

    def step_table(start: int, limit: int) -> list[dict]:
        hv = halfwords(w, start, (limit - start) // 2)
        out = []
        for i in range(0, len(hv) - 1, 2):
            key = s16(hv[i])
            out.append({"key": key, "hold": hv[i + 1]})
            if key == 0xFF:
                break  # the end marker the walk tests for at wstag820.s:301
        return out

    return {
        "stage": "820",
        "member": "0x34d",
        "member_id": 845,
        "tick": ram(0x06A8),
        "children": recs,
        "default": default,
        "tables": {
            # 0x71DC is the disc's table and 0x71F4 the column's; both run to
            # the 0x00FF marker key.  Read at wstag820.s:472-478 and :503-509.
            "disc": step_table(0x13FC, 0x1414),
            "column": step_table(0x1414, 0x14D8),
        },
        "sources": {
            "records": ram(0x13CC),
            "disc": ram(0x13FC),
            "column": ram(0x1414),
        },
    }


def render(data: dict) -> str:
    def rec(rows: list[dict]) -> str:
        return ", ".join(f"{{ key: {r['key']}, hold: {r['hold']} }}" for r in rows)

    def desc(rows: list[dict]) -> str:
        return ", ".join(f"{{ x: {r['x']}, y: {r['y']}, shape: {r['shape']} }}" for r in rows)

    a, b = data["805"], data["820"]
    lines = [
        "// GENERATED by tools/extract_annotator_tables.py from the stage overlay words.",
        "// Do not edit: run `tools/extract_annotator_tables.py` (or `--check`).",
        "//",
        "// The tables the two stage-owned annotator members of the resident 2D",
        "// draw-context service (registry id 0x1002) read out of their own overlay",
        "// image: the child descriptors, the delay walk, and the {key, hold} step",
        "// tables that pick each shape.  Decode:",
        "// docs/research/field/draw-context-service-2026-10-04.md",
        "",
        "/** One {key, hold} step record: the shape key a drawable shows and how long it holds. */",
        "export interface AnnotatorStep {",
        "  readonly key: number;",
        "  readonly hold: number;",
        "}",
        "",
        "/** A pooled child of the s805 annotator: where it sits and which shape slot it keeps. */",
        "export interface AnnotatorChild {",
        "  readonly x: number;",
        "  readonly y: number;",
        "  readonly shape: number;",
        "}",
        "",
        "/** One record of the s820 annotator's four-child table. */",
        "export interface AnnotatorRecord {",
        "  readonly hold: number;",
        "  /** 0 builds a child at this record's position, 2 builds the default child. */",
        "  readonly kind: number;",
        "  readonly x: number;",
        "  readonly y: number;",
        "}",
        "",
        "/** The s805 member 0x349: 27 pooled children walked one at a time. */",
        f"export const S805_ANNOTATOR_CHILDREN: readonly AnnotatorChild[] = [",
        f"  {desc(a['children'])},",
        "];",
        "",
        f"/** The delay walk's 28 bounds; the last is the {a['sources']['delay']} end marker. */",
        f"export const S805_ANNOTATOR_DELAY: readonly number[] = [",
        f"  {', '.join(str(x) for x in a['delay'])},",
        "];",
        "",
        "/** The three step tables the s805 children read. */",
        f"export const S805_ANNOTATOR_TABLES: Readonly<Record<'disc' | 'second' | 'column', readonly AnnotatorStep[]>> = {{",
        f"  disc: [{rec(a['tables']['disc'])}],",
        f"  second: [{rec(a['tables']['second'])}],",
        f"  column: [{rec(a['tables']['column'])}],",
        "};",
        "",
        "/** The s820 member 0x34d: four children, three placed from their record. */",
        f"export const S820_ANNOTATOR_RECORDS: readonly AnnotatorRecord[] = [",
    ]
    for r in b["children"]:
        lines.append(f"  {{ hold: {r['hold']}, kind: {r['kind']}, x: {r['x']}, y: {r['y']} }},")
    lines += [
        "];",
        "",
        "/** The kind-2 child's own constructor constants (child+0x54/+0x58/+0x50). */",
        f"export const S820_ANNOTATOR_DEFAULT: AnnotatorChild = {{ x: {b['default']['x']}, y: {b['default']['y']}, shape: {b['default']['hold']} }};",
        "",
        "/** The two step tables the s820 children read: the disc and the column. */",
        f"export const S820_ANNOTATOR_TABLES: Readonly<Record<'disc' | 'column', readonly AnnotatorStep[]>> = {{",
        f"  disc: [{rec(b['tables']['disc'])}],",
        f"  column: [{rec(b['tables']['column'])}],",
        "};",
        "",
        "/**",
        " * The shape set each overlay's annotator draws from: the CD resource id and",
        " * member its own field-config stub stores at the field object's `+0x0C`,",
        " * resolved by F0x800140D8 (`*(0x80044F5C)`).  The walker's extracted packs",
        " * carry no member 0 of any of these resources yet, so nothing is drawn from",
        " * them; the ids are here so the gap is a checked list and not a habit.",
        " * Decode: docs/research/field/draw-context-service-2026-10-04.md",
        " */",
        "export const ANNOTATOR_SHAPE_SETS: Readonly<Record<string, { resource: number; handle: number }>> = {",
    ]
    for name, info in data["shape_sets"]:
        lines.append(f'  "{name}": {{ resource: 0x{info["resource"]:X}, handle: 0x{info["handle"]:08X} }},')
    lines += [
        "};",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail if the generated file is stale")
    ap.add_argument("--json", action="store_true", help="dump the tables as JSON instead")
    args = ap.parse_args()

    data = {"805": s805(), "820": s820()}
    data["shape_sets"] = [
        (name.replace("wstag", "s"), shape_set_resource(name)) for name in FAMILY
    ]
    if args.json:
        json.dump(data, sys.stdout, indent=1)
        print()
        return 0
    text = render(data)
    if args.check:
        try:
            have = open(OUT).read()
        except OSError as exc:
            print(f"extract_annotator_tables: {exc}", file=sys.stderr)
            return 1
        if have != text:
            print("extract_annotator_tables: engine/dw3/annotator-tables.ts is stale", file=sys.stderr)
            return 1
        print("extract_annotator_tables: up to date")
        return 0
    with open(OUT, "w") as fh:
        fh.write(text)
    print(f"extract_annotator_tables: wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())