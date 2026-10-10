#!/usr/bin/env python3
"""Extract the STAGE NATIVE-OVERLAY SHAPE DRAW: the per-frame table of shapes a
`wstag` overlay paints through the resident 2D draw-context service.

This is the second producer of an over/under-entity drawable besides the
point-sprite record and the map-tile foreground, and it is authored DATA, not
per-stage code: a stage whose base tick builds the transient draw-context block
(`F0x8001f648`, `exe/fns.s:16377`) and then loops calling that block's `+0x84`
slot -- the shared shape emitter `F0x8001ED6C` -- over an 8-byte {x,y} position
table is running this system. The emitter resolves the shape's pixels from the
stage's own TMPK sprite directory, member 0 (`F0x800140D8` splits the `lui`
handle at the field object's `+0x0C` as `resource = arg>>16, member = arg&0xffff`),
the same directory the ambient point sprites, the launch pads and the annotator
family read.

The base-tick shape loop reads:

    li   $a0, <resource<<16>          # the stage's S<stage>TMPK index
    jal  F0x800140D8                  # -> the shape set
    move $a1, $zr                     # shape id (0 on s375)
    lw   $v0, ($s0)                   # table entry x  (8-byte stride)
    lw   $v1, 0x4($s0)
    addiu $s0, $s0, 8
    lw   $a2, <camX>; lw $a3, <camY>  # (scroll - base) >> 3, the parallax term
    addu $a2, $v0, $a2; addu $a3, $v1, $a3
    lw   $v0, <block+0x84>($sp); jalr $v0          # emit (shapeSet,id,x,y)
    slti $v0, $s1, <count>; bnez ...

The block's `+0x7C` slot (`F0x8001ed34`) resolves the `0x1002` context and calls
its `+0x138` ordering-table accessor, so the `li $a1, <bucket>` that precedes it
is the ordering-table bucket the shapes are linked into (s375: 12, behind the
entity bucket 4 -- the shapes land under the map).

Output: web/assets/data/stage_overlay_shapes.json -- one entry per stage
carrying {resource, bucket, baseX, baseY, shift, shapes:[{id,x,y}]}.

Usage: tools/extract_stage_overlay_shapes.py [--check] [--list] [STAGE...]
"""
from __future__ import annotations
from pathlib import Path
import os

import json
import pathlib
import re
import struct
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
ASM = pathlib.Path(os.environ.get("DDW3_DIR") or pathlib.Path.home() / "ddw3") / "asm/dw2003/pro"
LBA_RS = pathlib.Path(os.environ.get("DDW3_DIR") or pathlib.Path.home() / "ddw3") / "rust/dw2003_exe_data/src/lba.rs"
OUT = REPO / "web/assets/data/stage_overlay_shapes.json"

OVERLAY_BASE = 0x800A5DE0
F648 = 0x8001F648  # transient draw-context block builder
JAL_F648 = 0x0C000000 | ((F648 >> 2) & 0x03FFFFFF)

WORD_RE = re.compile(
    r"\.L0x([0-9a-f]{8}): (?:\.[a-z]+ 0x([0-9a-f]+)|.*?# \.word 0x([0-9a-f]+))"
)


def load_image(path: pathlib.Path) -> bytes:
    words: dict[int, int] = {}
    for m in WORD_RE.finditer(path.read_text()):
        words[int(m.group(1), 16)] = int(m.group(2) or m.group(3), 16)
    if not words:
        return b""
    size = max(words) + 4
    img = bytearray(size)
    for off, w in words.items():
        struct.pack_into("<I", img, off, w)
    return bytes(img)


def lba_index() -> dict[int, str]:
    out: dict[int, str] = {}
    for line in LBA_RS.read_text().splitlines():
        m = re.match(r"pub const (\w+): usize = (\d+);", line)
        if m:
            out[int(m.group(2))] = m.group(1)
    return out


def sign16(v: int) -> int:
    return v - 0x10000 if v >= 0x8000 else v


def detect(data: bytes, stage: str, lba: dict[int, str]) -> dict | None:
    """One stage's base-tick shape table, or None."""
    want = f"LBA_{stage.upper()}TMPK_BIN_IDX"
    resource = next((i for i, n in lba.items() if n == want), None)
    if resource is None:
        return None
    res_hi = resource & 0xFFFF if resource <= 0xFFFF else None
    nwords = len(data) // 4
    words = struct.unpack_from(f"<{nwords}I", data)

    def op(w: int) -> int:
        return w >> 26

    def rs(w: int) -> int:
        return (w >> 21) & 31

    def rt(w: int) -> int:
        return (w >> 16) & 31

    for i, w in enumerate(words):
        if w != JAL_F648:
            continue
        # block base: the `addiu $a0, $sp, K` in this call's setup -- usually the
        # delay slot (i+1), else just above.
        blk = None
        for j in (i + 1, i - 1, i - 2, i - 3):
            if j < 0:
                break
            wj = words[j]
            if op(wj) == 0x09 and rs(wj) == 29 and rt(wj) == 4:
                blk = sign16(wj & 0xFFFF)
                break
        if blk is None:
            continue
        slot84 = blk + 0x84
        slot7c = blk + 0x7C
        # find the loop's `lw $v0, slot84($sp)` and the table stride in the region.
        table = count = None
        bucket = None
        base = {}
        for k in range(i, min(i + 260, nwords)):
            wk = words[k]
            if op(wk) == 0x23 and rs(wk) == 29 and sign16(wk & 0xFFFF) == slot84:
                # table reg = the register loaded as `lw r, ($r)` / `lw r,4($r)`
                # immediately above; find the `addiu r, 0x8` and its lui/addiu base.
                for b in range(k - 1, max(k - 12, i), -1):
                    wb = words[b]
                    if op(wb) == 0x09 and rt(wb) == rs(wb) and sign16(wb & 0xFFFF) == 8:
                        r = rs(wb)
                        for c in range(b - 1, max(b - 40, i), -1):
                            wc = words[c]
                            if op(wc) == 0x09 and rt(wc) == r and rs(wc) != r:
                                src = rs(wc)
                                # find the lui of src (usually the word before)
                                for d in range(c - 1, max(c - 6, i), -1):
                                    wd = words[d]
                                    if op(wd) == 0x0F and rt(wd) == src:
                                        hi = (wd & 0xFFFF) << 16
                                        table = (hi + sign16(wc & 0xFFFF)) & 0xFFFFFFFF
                                        break
                                break
                        break
                break
            if op(wk) == 0x23 and rs(wk) == 29 and sign16(wk & 0xFFFF) == slot7c:
                # `li $a1, bucket` a few words above the +0x7C publish.
                for b in range(k - 1, max(k - 8, i), -1):
                    wb = words[b]
                    if op(wb) == 0x09 and rs(wb) == 29:
                        # a1 set from sp earlier; look one more back
                        continue
                    if op(wb) == 0x09 and rs(wb) == 0 and rt(wb) == 5:
                        bucket = sign16(wb & 0xFFFF)
                        break
        if table is None:
            continue
        # boundary: the `slti $v?, $s?, N` that ends the loop.
        for k in range(i, min(i + 260, nwords)):
            wk = words[k]
            if op(wk) == 0x0A:
                n = sign16(wk & 0xFFFF)
                if 0 < n <= 0x400:
                    count = n
                    break
        if not count:
            continue
        # parallax: `addiu $v?, $v?, -N; sra $v?, 0x3` pairs.
        consts: list[int] = []
        for k in range(i, min(i + 60, nwords)):
            wk = words[k]
            if op(wk) == 0 and (wk & 0x3F) == 0x03 and ((wk >> 6) & 31) == 3:
                rd = (wk >> 11) & 31
                wprev = words[k - 1] if k else 0
                if op(wprev) == 0x09 and rt(wprev) == rd and rs(wprev) == rd:
                    v = sign16(wprev & 0xFFFF)
                    if 0x100 <= -v <= 0x4000 and -v not in consts:
                        consts.append(-v)
        # the TMPK handle: a `lui $a0, <resource>` in this function region.
        if res_hi is not None:
            for k in range(i, min(i + 260, nwords)):
                wk = words[k]
                if op(wk) == 0x0F and rt(wk) == 4 and (wk & 0xFFFF) == res_hi:
                    break
            else:
                continue
        else:
            # resource needs `ori` low half: not supported
            continue
        # read the table.
        toff = (table - OVERLAY_BASE) & 0xFFFFFFFF
        if not (0 <= toff <= len(data) - 8 * count):
            continue
        shapes = []
        for e in range(count):
            x, y = struct.unpack_from("<2I", data, toff + e * 8)
            shapes.append({"id": 0, "x": x, "y": y})
        base = {"baseX": consts[0] if consts else 0, "baseY": consts[1] if len(consts) > 1 else 0}
        return {
            "resource": resource,
            "bucket": bucket,
            "shift": 3,
            "baseX": base["baseX"],
            "baseY": base["baseY"],
            "shapes": shapes,
            "table": toff,
            "count": count,
        }
    return None


def collect(stages: list[str] | None = None) -> dict[str, dict]:
    lba = lba_index()
    out: dict[str, dict] = {}
    for path in sorted(ASM.glob("wstag*.s")):
        stage = "s" + re.match(r"wstag(\d+)", path.stem).group(1)
        if stages and stage not in stages:
            continue
        data = load_image(path)
        if not data:
            continue
        got = detect(data, stage, lba)
        if got:
            out[stage] = got
    return out


def main() -> int:
    ap = __import__("argparse").ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("stages", nargs="*")
    args = ap.parse_args()
    data = collect(args.stages or None)
    if args.list:
        for stage, info in data.items():
            print(f"{stage}: resource 0x{info['resource']:X} bucket {info['bucket']} "
                  f"base {info['baseX']:#x}/{info['baseY']:#x} shapes {info['count']}")
        print(f"total {len(data)} stages")
        return 0
    text = json.dumps(data, indent=1) + "\n"
    if args.check:
        if OUT.exists() and OUT.read_text() == text:
            print(f"{OUT.name} up to date")
            return 0
        print(f"{OUT.name} is stale", file=sys.stderr)
        return 1
    OUT.write_text(text)
    print(f"wrote {OUT.name}: {len(data)} stages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
